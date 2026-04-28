import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

// Migrate legacy localStorage keys used by earlier versions to the new keys.
// This migration is destructive: it copies legacy values to the new keys,
// sets a one-time marker `prompt_verify_migrated`, and removes the legacy
// keys so they don't linger in localStorage.
function migrateLocalStorage() {
    try {
        if (typeof localStorage === 'undefined') return
        if (localStorage.getItem('prompt_verify_migrated') === '1') return

        const legacyPrefixes = [
            'prompt_verify_float_pos_',
            'prompt_verify_float_size_',
        ]
        const keysToDelete = []
        for (const key of Object.keys(localStorage)) {
            try {
                for (const p of legacyPrefixes) {
                    if (key.startsWith(p)) { keysToDelete.push(key); break }
                }
            } catch(e) {}
        }
        try { localStorage.setItem('prompt_verify_migrated', '1') } catch(e) {}
        for (const k of keysToDelete) { try { localStorage.removeItem(k) } catch(e) {} }
    } catch(e) {}
}

function send_message(node_id, message) {
    const body = new FormData()
    body.append('message', message)
    body.append('node_id', node_id)
    api.fetchApi("/prompt_verify_response", { method: "POST", body })
}

// Called when the server fires prompt_verify_request.
// Routes directly into the node's own in-node UI — no floating panel.
function prompt_verify_request(msg) {
    console.debug('prompt_verify: received prompt_verify_request', msg.detail)
    const nodeId = msg.detail.node_id
    const timeup = !!msg.detail.timeup

    const node = app.graph && app.graph._nodes_by_id && app.graph._nodes_by_id[nodeId]
    if (!node) {
        console.warn('prompt_verify: node not found in graph', nodeId)
        return
    }

    if (timeup) {
        if (node.receive_prompt_verify_timeup) node.receive_prompt_verify_timeup()
        return
    }

    if (node.receive_prompt_verify_request) node.receive_prompt_verify_request(msg.detail.message || '')
}

function registerWithApp(app) {
    app.registerExtension({
        name: "prompt_verify",

        // -------------------------------------------------------------------
        // beforeRegisterNodeDef — attach prototype methods to the node class
        // -------------------------------------------------------------------
        async beforeRegisterNodeDef(nodeType, nodeData, app) {
            if (nodeType?.comfyClass !== "Prompt Verify") return

            function findEditorWidget(node) {
                if (!node || !node.widgets) return null
                for (const w of node.widgets) {
                    try {
                        if (!w) continue
                        if (w.multiline) return w
                        if (w.element && w.element.tagName && w.element.tagName.toLowerCase() === 'textarea') return w
                        if ((w.name && w.name.toLowerCase() === 'editor') || (w.label && w.label.toLowerCase() === 'editor')) return w
                        if (w.element && ('value' in w)) return w
                    } catch(e) {}
                }
                return node.widgets[2] || null
            }

            // Populate the in-node editor with incoming text and activate submit button
            nodeType.prototype.receive_prompt_verify_request = function(msg) {
                console.debug(`prompt_verify: node ${this.id} receive_prompt_verify_request`)
                const w = findEditorWidget(this)
                if (!w) return console.warn('Prompt Verify: editor widget not found', { nodeId: this.id })

                try { w.value = msg } catch(e) {}

                const flushToElement = (el) => {
                    try { el.disabled = false } catch(e) {}
                    try {
                        el.value = msg
                        el.dispatchEvent(new Event('input', { bubbles: true }))
                    } catch(e) {}
                }

                if (w.element) {
                    flushToElement(w.element)
                } else {
                    this._prompt_verify_pending_text = msg
                    const nodeEl = this.element
                    if (nodeEl) {
                        const obs = new MutationObserver(() => {
                            if (w.element) {
                                obs.disconnect()
                                flushToElement(w.element)
                                this._prompt_verify_pending_text = null
                            }
                        })
                        obs.observe(nodeEl, { childList: true, subtree: true })
                        let attempts = 0
                        const poll = setInterval(() => {
                            attempts++
                            if (w.element) {
                                clearInterval(poll); obs.disconnect()
                                flushToElement(w.element)
                                this._prompt_verify_pending_text = null
                            } else if (attempts > 50) {
                                clearInterval(poll); obs.disconnect()
                                console.warn('prompt_verify: textarea never appeared for node', this.id)
                            }
                        }, 100)
                    }
                }

                // Activate submit button
                try {
                    if (this._prompt_verify_submit_button) {
                        this._prompt_verify_submit_button.disabled = false
                        this._prompt_verify_submit_button.style.opacity = '1'
                        this._prompt_verify_submit_button.style.cursor = 'pointer'
                    }
                } catch(e) {}
                // Update status
                try {
                    if (this._prompt_verify_status_el) {
                        this._prompt_verify_status_el.textContent = '⏳ Waiting for input…'
                        this._prompt_verify_status_el.style.color = '#facc15'
                    }
                } catch(e) {}
            }

            // Auto-submit current editor value on timeout
            nodeType.prototype.receive_prompt_verify_timeup = function() {
                const w = findEditorWidget(this)
                if (!w) return console.warn('Prompt Verify: editor widget not found')
                send_message(this.id, w.value || '')
                try {
                    if (this._prompt_verify_submit_button) {
                        this._prompt_verify_submit_button.disabled = true
                        this._prompt_verify_submit_button.style.opacity = '0.4'
                        this._prompt_verify_submit_button.style.cursor = 'default'
                    }
                } catch(e) {}
                try {
                    if (this._prompt_verify_status_el) {
                        this._prompt_verify_status_el.textContent = '⏱ Timed out — auto-submitted'
                        this._prompt_verify_status_el.style.color = '#f87171'
                    }
                } catch(e) {}
            }

            // Shift+Enter keyboard shortcut submits from the editor textarea
            nodeType.prototype.handle_key = function(e) {
                if (e.key === 'Enter' && e.shiftKey) {
                    const w = findEditorWidget(this)
                    if (!w) return
                    const btn = this._prompt_verify_submit_button
                    if (btn && !btn.disabled) {
                        send_message(this.id, w.value || '')
                        btn.disabled = true
                        btn.style.opacity = '0.4'
                        btn.style.cursor = 'default'
                        try {
                            if (this._prompt_verify_status_el) {
                                this._prompt_verify_status_el.textContent = '✔ Submitted'
                                this._prompt_verify_status_el.style.color = '#4ade80'
                            }
                        } catch(e) {}
                    }
                }
            }
        },

        // -------------------------------------------------------------------
        // nodeCreated — runs once per node instance.
        // Builds the Submit widget and Save/Load widget inside the node.
        // -------------------------------------------------------------------
        async nodeCreated(node) {
            if (!node.receive_prompt_verify_request) return

            function findEditorWidget(node) {
                if (!node || !node.widgets) return null
                for (const w of node.widgets) {
                    try {
                        if (!w) continue
                        if (w.multiline) return w
                        if (w.element && w.element.tagName && w.element.tagName.toLowerCase() === 'textarea') return w
                        if ((w.name && w.name.toLowerCase() === 'editor') || (w.label && w.label.toLowerCase() === 'editor')) return w
                        if (w.element && ('value' in w)) return w
                    } catch(e) {}
                }
                return node.widgets[2] || null
            }

            let editor = findEditorWidget(node) || node.widgets[1] || node.widgets[2]

            // Attach Shift+Enter once the textarea element exists
            if (editor) {
                const attachKeydown = () => {
                    try { editor.element.addEventListener('keydown', node.handle_key.bind(node)) } catch(e) {}
                }
                if (editor.element) attachKeydown()
                else {
                    let _kd = 0
                    const _kdPoll = setInterval(() => {
                        _kd++
                        if (editor.element) { clearInterval(_kdPoll); attachKeydown() }
                        else if (_kd > 50) clearInterval(_kdPoll)
                    }, 100)
                }
            }

            // ---------------------------------------------------------------
            // Submit widget
            // ---------------------------------------------------------------
            const submitContainer = document.createElement('div')
            submitContainer.style.cssText = 'padding:4px 6px 4px;display:flex;gap:6px;align-items:center;'

            const submitBtn = document.createElement('button')
            submitBtn.type = 'button'
            submitBtn.textContent = '▶  Submit'
            submitBtn.disabled = true
            submitBtn.style.cssText = [
                'flex:1;padding:6px 12px;border-radius:5px;',
                'background:#28a745;color:white;border:none;',
                'font-size:12px;font-weight:700;letter-spacing:0.02em;',
                'opacity:0.4;cursor:default;transition:opacity 0.15s;',
            ].join('')
            submitBtn.title = 'Submit editor text and continue the workflow (Shift+Enter)'

            const statusEl = document.createElement('span')
            statusEl.style.cssText = 'font-size:10px;color:#888;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:1;'
            statusEl.textContent = 'Idle'

            submitContainer.appendChild(submitBtn)
            submitContainer.appendChild(statusEl)

            // Expose on node so prototype methods can reach them
            node._prompt_verify_submit_button = submitBtn
            node._prompt_verify_status_el     = statusEl

            submitBtn.addEventListener('click', () => {
                if (submitBtn.disabled) return
                const w = findEditorWidget(node)
                const val = (w && w.value != null) ? w.value : ''
                send_message(node.id, val)
                submitBtn.disabled = true
                submitBtn.style.opacity = '0.4'
                submitBtn.style.cursor = 'default'
                statusEl.textContent = '✔ Submitted'
                statusEl.style.color = '#4ade80'
            })

            const submitWidget = node.addDOMWidget('prompt_verify_submit', 'div', submitContainer, {
                getValue() { return null },
                setValue() {},
                getMinHeight() { return 38 },
                getMaxHeight() { return 38 },
            })

            // ---------------------------------------------------------------
            // Save / Load widget
            // ---------------------------------------------------------------
            const slContainer = document.createElement('div')
            slContainer.style.cssText = 'padding:4px 6px 6px;display:flex;flex-direction:column;gap:5px;'

            const selStyle   = 'flex:1;min-width:60px;padding:4px 6px;border-radius:4px;border:1px solid #444;background:#1a1a1a;color:#fff;font-size:11px;'
            const inputStyle = 'flex:1;min-width:60px;padding:4px 6px;border-radius:4px;border:1px solid #444;background:#1a1a1a;color:#fff;font-size:11px;'
            const mkBtn      = (bg) => `padding:4px 8px;border-radius:4px;background:${bg};color:white;border:none;cursor:pointer;font-size:11px;font-weight:600;white-space:nowrap;`
            const rowStyle   = 'display:flex;gap:4px;align-items:center;'

            // Load row
            const loadRow    = document.createElement('div')
            loadRow.style.cssText = rowStyle
            const loadCatSel = document.createElement('select')
            loadCatSel.style.cssText = selStyle
            loadCatSel.title = 'Category'
            const loadNameSel = document.createElement('select')
            loadNameSel.style.cssText = selStyle
            loadNameSel.title = 'Prompt name'
            const loadBtn = document.createElement('button')
            loadBtn.type = 'button'
            loadBtn.textContent = 'Load'
            loadBtn.style.cssText = mkBtn('#6f42c1')
            loadBtn.title = 'Load selected prompt into editor'
            loadRow.appendChild(loadCatSel)
            loadRow.appendChild(loadNameSel)
            loadRow.appendChild(loadBtn)

            // Save row
            const saveRow = document.createElement('div')
            saveRow.style.cssText = rowStyle
            const saveCatInput = document.createElement('input')
            saveCatInput.type = 'text'
            saveCatInput.placeholder = 'Category'
            saveCatInput.style.cssText = inputStyle
            saveCatInput.title = 'Category to save into'
            const saveNameInput = document.createElement('input')
            saveNameInput.type = 'text'
            saveNameInput.placeholder = 'Prompt name'
            saveNameInput.style.cssText = inputStyle
            saveNameInput.title = 'Name for this prompt'
            const saveBtn = document.createElement('button')
            saveBtn.type = 'button'
            saveBtn.textContent = 'Save'
            saveBtn.style.cssText = mkBtn('#0d6efd')
            saveBtn.title = 'Save editor text as a named prompt'
            saveRow.appendChild(saveCatInput)
            saveRow.appendChild(saveNameInput)
            saveRow.appendChild(saveBtn)

            const slStatus = document.createElement('div')
            slStatus.style.cssText = 'font-size:10px;min-height:13px;padding:0 2px;'

            slContainer.appendChild(loadRow)
            slContainer.appendChild(saveRow)
            slContainer.appendChild(slStatus)

            // Prompts data cache
            let _promptsData = {}

            function populateLoadCat(data) {
                _promptsData = data
                const prev = loadCatSel.value
                loadCatSel.innerHTML = ''
                const cats = Object.keys(data).filter(k => k !== '__meta__').sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
                if (cats.length === 0) {
                    loadCatSel.innerHTML = '<option value="">— empty —</option>'
                    loadNameSel.innerHTML = ''
                    return
                }
                cats.forEach(c => {
                    const o = document.createElement('option')
                    o.value = c; o.textContent = c
                    loadCatSel.appendChild(o)
                })
                loadCatSel.value = cats.includes(prev) ? prev : cats[0]
                populateLoadName(loadCatSel.value)
            }

            function populateLoadName(cat) {
                const prev = loadNameSel.value
                loadNameSel.innerHTML = ''
                const catData = _promptsData[cat] || {}
                const names = Object.keys(catData).filter(k => k !== '__meta__').sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
                if (names.length === 0) {
                    loadNameSel.innerHTML = '<option value="">— empty —</option>'
                    return
                }
                names.forEach(n => {
                    const o = document.createElement('option')
                    o.value = n; o.textContent = n
                    loadNameSel.appendChild(o)
                })
                if (names.includes(prev)) loadNameSel.value = prev
            }

            loadCatSel.addEventListener('change', () => populateLoadName(loadCatSel.value))

            async function refreshPrompts() {
                try {
                    const r = await fetch('/prompt_verify/get-prompts')
                    const j = await r.json()
                    if (j.success) populateLoadCat(j.prompts)
                    else loadCatSel.innerHTML = '<option value="">— error —</option>'
                } catch(e) {
                    loadCatSel.innerHTML = '<option value="">— unavailable —</option>'
                }
            }
            refreshPrompts()

            // Load button — write selected prompt into the editor widget
            loadBtn.addEventListener('click', () => {
                const cat  = loadCatSel.value
                const name = loadNameSel.value
                if (!cat || !name) return
                const entry = _promptsData[cat] && _promptsData[cat][name]
                if (!entry) return
                const text = typeof entry === 'string' ? entry : (entry.prompt || '')
                if (editor) {
                    try { editor.value = text } catch(e) {}
                    if (editor.element) {
                        try {
                            editor.element.value = text
                            editor.element.dispatchEvent(new Event('input', { bubbles: true }))
                        } catch(e) {}
                    } else {
                        node._prompt_verify_pending_text = text
                    }
                }
                slStatus.textContent = `Loaded: ${name}`
                slStatus.style.color = '#a78bfa'
            })

            // Save button — persist current editor text to prompt library
            saveBtn.addEventListener('click', async () => {
                const category = saveCatInput.value.trim()
                const name     = saveNameInput.value.trim()
                const text     = editor ? editor.value : ''
                if (!category || !name) {
                    slStatus.textContent = 'Enter category and name first.'
                    slStatus.style.color = '#f87171'
                    return
                }
                saveBtn.disabled = true
                slStatus.textContent = 'Saving…'
                slStatus.style.color = '#aaa'
                try {
                    const r = await fetch('/prompt_verify/save-prompt', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ category, name, text })
                    })
                    const j = await r.json()
                    if (j.success) {
                        slStatus.textContent = `Saved: "${name}" in "${category}"`
                        slStatus.style.color = '#4ade80'
                        saveNameInput.value = ''
                        refreshPrompts()
                    } else {
                        slStatus.textContent = j.error || 'Save failed.'
                        slStatus.style.color = '#f87171'
                    }
                } catch(e) {
                    slStatus.textContent = 'Error: ' + e.message
                    slStatus.style.color = '#f87171'
                }
                saveBtn.disabled = false
            })

            // Measure natural height after first paint and lock min/max to it
            slContainer.style.overflow = 'hidden'
            let naturalH = 80

            const saveLoadWidget = node.addDOMWidget('prompt_verify_save_load', 'div', slContainer, {
                getValue() { return null },
                setValue() {},
                getMinHeight() { return naturalH },
                getMaxHeight() { return naturalH },
            })

            requestAnimationFrame(() => {
                try {
                    slContainer.style.height = 'auto'
                    const measured = slContainer.scrollHeight
                    if (measured > 0) {
                        naturalH = measured + 16
                        slContainer.style.height = naturalH + 'px'
                        node.setSize(node.size)
                    }
                } catch(e) {}
            })

            // ---------------------------------------------------------------
            // Reorder: editor → submitWidget → saveLoadWidget → panel params
            // ---------------------------------------------------------------
            try {
                const editorIdx = node.widgets.findIndex(w => w && w.name === 'editor')
                const submitIdx = node.widgets.indexOf(submitWidget)
                const slIdx     = node.widgets.indexOf(saveLoadWidget)

                // Remove both (highest index first to avoid offset shifting)
                const toRemove = [submitIdx, slIdx].filter(i => i !== -1).sort((a, b) => b - a)
                for (const i of toRemove) node.widgets.splice(i, 1)

                // Find editor again after removals and insert submit then saveLoad after it
                const base = node.widgets.findIndex(w => w && w.name === 'editor')
                const insertAt = base !== -1 ? base + 1 : node.widgets.length
                node.widgets.splice(insertAt, 0, submitWidget)
                node.widgets.splice(insertAt + 1, 0, saveLoadWidget)
            } catch(e) { console.debug('prompt_verify: could not reorder widgets', e) }
        },

        setup() {
            try { migrateLocalStorage() } catch(e) {}
            api.addEventListener("prompt_verify_request", prompt_verify_request)
        }
    })
}

try {
    registerWithApp(app)
} catch(e) {
    console.error('prompt_verify: failed to register extension', e)
}
