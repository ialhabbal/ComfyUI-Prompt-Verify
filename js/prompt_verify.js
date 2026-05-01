import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

// ---------------------------------------------------------------------------
// localStorage migration — remove legacy keys from earlier versions
// ---------------------------------------------------------------------------
function migrateLocalStorage() {
    try {
        if (typeof localStorage === 'undefined') return
        if (localStorage.getItem('prompt_verify_migrated') === '1') return
        const legacyPrefixes = ['prompt_verify_float_pos_', 'prompt_verify_float_size_']
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

// ---------------------------------------------------------------------------
// Submit the edited text back to the Python node that is waiting
// ---------------------------------------------------------------------------
function send_message(node_id, message) {
    const body = new FormData()
    body.append('message', message)
    body.append('node_id', node_id)
    api.fetchApi("/prompt_verify_response", { method: "POST", body })
}

// ---------------------------------------------------------------------------
// Route server-pushed events into the correct node instance
// ---------------------------------------------------------------------------
function prompt_verify_request(msg) {
    console.debug('prompt_verify: received prompt_verify_request', msg.detail)
    const nodeId = msg.detail.node_id
    const timeup = !!msg.detail.timeup
    const node = app.graph && app.graph._nodes_by_id && app.graph._nodes_by_id[nodeId]
    if (!node) { console.warn('prompt_verify: node not found in graph', nodeId); return }
    if (timeup) {
        if (node.receive_prompt_verify_timeup) node.receive_prompt_verify_timeup()
        return
    }
    if (node.receive_prompt_verify_request) node.receive_prompt_verify_request(msg.detail.message || '')
}

// ---------------------------------------------------------------------------
// Shared helper — find the textarea-backed "editor" widget on a node
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Write text into both the widget value and its live DOM textarea element.
// Queues the write if the element has not mounted yet, and fires an
// "input" event so ComfyUI picks up the change.
// ---------------------------------------------------------------------------
function writeToEditor(node, text) {
    // Primary path: write into our own textarea inside the master widget
    if (node._prompt_verify_textarea) {
        try {
            node._prompt_verify_textarea.value = text
            node._prompt_verify_textarea.dispatchEvent(new Event('input', { bubbles: true }))
        } catch(e) {}
    }
    // Also keep the native (hidden) editor widget value in sync for serialisation
    const w = findEditorWidget(node)
    if (w) try { w.value = text } catch(e) {}
}

// ---------------------------------------------------------------------------
// Extension registration
// ---------------------------------------------------------------------------
function registerWithApp(app) {
    app.registerExtension({
        name: "prompt_verify",

        // -------------------------------------------------------------------
        // Prototype methods — attached to every PromptVerify node class
        // -------------------------------------------------------------------
        async beforeRegisterNodeDef(nodeType, nodeData) {
            if (nodeType?.comfyClass !== "Prompt Verify") return

            // Populate editor with the text that arrived from the server
            nodeType.prototype.receive_prompt_verify_request = function(msg) {
                console.debug(`prompt_verify: node ${this.id} receive_prompt_verify_request`)
                
                // Get toggle states from node widgets
                const useExternalInput = this.widgets && this.widgets.some(w => w && w.name === 'use_external_text_input' && w.value === true)
                const useLLMInput = this.widgets && this.widgets.some(w => w && w.name === 'use_llm_input' && w.value === true)
                const anyToggleOn = useExternalInput || useLLMInput
                
                const w = findEditorWidget(this)
                const currentText = (w && w.value) || (this._prompt_verify_textarea && this._prompt_verify_textarea.value) || ''
                const hasText = currentText.trim() !== ''
                
                if (!anyToggleOn) {
                    // Both toggles OFF
                    if (hasText) {
                        // Editor has text — auto-submit it
                        send_message(this.id, currentText)
                        try {
                            if (this._prompt_verify_submit_button) {
                                this._prompt_verify_submit_button.disabled = true
                                this._prompt_verify_submit_button.style.opacity = '0.4'
                                this._prompt_verify_submit_button.style.cursor = 'default'
                            }
                        } catch(e) {}
                        try {
                            if (this._prompt_verify_status_el) {
                                this._prompt_verify_status_el.textContent = '✔ Auto-submitted'
                                this._prompt_verify_status_el.style.color = '#4ade80'
                            }
                        } catch(e) {}
                    } else {
                        // Editor is empty — wait for input
                        writeToEditor(this, msg)
                        try {
                            const btn = this._prompt_verify_submit_button
                            if (btn) {
                                btn.disabled = false
                                btn.style.opacity = '1'
                                btn.style.cursor = 'pointer'
                            }
                        } catch(e) {}
                        try {
                            const st = this._prompt_verify_status_el
                            if (st) {
                                st.textContent = '⏳ Waiting for input…'
                                st.style.color = '#facc15'
                            }
                        } catch(e) {}
                    }
                } else {
                    // At least one toggle ON — replace text with incoming and wait for submit
                    writeToEditor(this, msg)
                    try {
                        const btn = this._prompt_verify_submit_button
                        if (btn) {
                            btn.disabled = false
                            btn.style.opacity = '1'
                            btn.style.cursor = 'pointer'
                        }
                    } catch(e) {}
                    try {
                        const st = this._prompt_verify_status_el
                        if (st) {
                            st.textContent = '⏳ Waiting for input…'
                            st.style.color = '#facc15'
                        }
                    } catch(e) {}
                }
            }

            // Auto-submit when the server-side timeout fires
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

            // Shift+Enter shortcut — wired up once the textarea is available
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
        // Per-instance setup — one DOM widget owns everything:
        //   [textarea editor]  ← top
        //   [save/load panel]  ← middle
        //   [submit button]    ← bottom
        // The native 'editor' widget from ComfyUI is hidden (height=0) so
        // LiteGraph still serialises its value, but it takes no visual space.
        // -------------------------------------------------------------------
        async nodeCreated(node) {
            if (!node.receive_prompt_verify_request) return

            // Find the native editor widget ComfyUI registered from the Python node
            const nativeEditor = findEditorWidget(node)

            // Hide it: zero height so it occupies no space in the node
            if (nativeEditor) {
                try {
                    nativeEditor.getMinHeight = () => 0
                    nativeEditor.getMaxHeight = () => 0
                } catch(e) {}
                // Also hide the DOM element once it mounts
                const hideEl = (el) => {
                    el.style.cssText = 'display:none!important;height:0!important;min-height:0!important;overflow:hidden!important;'
                    el.parentElement && (el.parentElement.style.display = 'none')
                }
                if (nativeEditor.element) hideEl(nativeEditor.element)
                else {
                    let _h = 0
                    const _hPoll = setInterval(() => {
                        _h++
                        if (nativeEditor.element) { clearInterval(_hPoll); hideEl(nativeEditor.element) }
                        else if (_h > 50) clearInterval(_hPoll)
                    }, 100)
                }
            }

            // ---------------------------------------------------------------
            // Master container — one widget, correct visual order
            // ---------------------------------------------------------------
            const EDITOR_H = 160

            const container = document.createElement('div')
            container.style.cssText = 'display:flex;flex-direction:column;gap:0;font-family:sans-serif;width:100%;box-sizing:border-box;'

            // ── Textarea (our own — replaces the native editor visually) ────
            const textarea = document.createElement('textarea')
            textarea.style.cssText = [
                `height:${EDITOR_H}px;min-height:${EDITOR_H}px;max-height:${EDITOR_H}px;`,
                'width:100%;box-sizing:border-box;resize:none;',
                'padding:6px 8px;background:transparent;color:inherit;',
                'border:1px solid rgba(255,255,255,0.15);border-radius:4px 4px 0 0;',
                'font-size:12px;line-height:1.5;font-family:monospace;',
                'outline:none;',
            ].join('')
            textarea.placeholder = 'Type or load a prompt…'

            // Keep the native widget value in sync so ComfyUI serialises it
            textarea.addEventListener('input', () => {
                if (nativeEditor) try { nativeEditor.value = textarea.value } catch(e) {}
            })

            // Shift+Enter submits
            textarea.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && e.shiftKey) {
                    e.preventDefault()
                    if (submitBtn && !submitBtn.disabled) submitBtn.click()
                }
            })

            // Restore content from native widget value on tab-switch / remount
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible' && nativeEditor) {
                    try {
                        const saved = nativeEditor.value || ''
                        if (textarea.value !== saved) textarea.value = saved
                    } catch(e) {}
                }
            })

            container.appendChild(textarea)

            // ── Submit row ──────────────────────────────────────────────────
            const submitRow = document.createElement('div')
            submitRow.style.cssText = [
                'display:flex;gap:6px;align-items:center;',
                'padding:4px 6px;',
                'background:transparent;border:1px solid rgba(255,255,255,0.15);border-top:none;border-radius:0 0 4px 4px;',
                'margin-bottom:2px;',
            ].join('')

            const submitBtn = document.createElement('button')
            submitBtn.type = 'button'
            submitBtn.textContent = '▶  Submit'
            submitBtn.disabled = true
            submitBtn.style.cssText = [
                'flex:1;padding:5px 12px;border-radius:4px;',
                'background:rgba(255,255,255,0.1);color:inherit;border:1px solid rgba(255,255,255,0.2);',
                'font-size:12px;font-weight:700;',
                'opacity:0.4;cursor:default;transition:opacity 0.15s;',
            ].join('')
            submitBtn.title = 'Submit editor text and continue the workflow (Shift+Enter)'

            const statusEl = document.createElement('span')
            statusEl.style.cssText = 'font-size:10px;color:#888;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:1;'
            statusEl.textContent = 'Idle'

            submitRow.appendChild(submitBtn)
            submitRow.appendChild(statusEl)
            container.appendChild(submitRow)

            // Expose on node so prototype methods can reach them
            node._prompt_verify_submit_button = submitBtn
            node._prompt_verify_status_el     = statusEl

            // Also expose the textarea so writeToEditor can target it
            node._prompt_verify_textarea = textarea

            submitBtn.addEventListener('click', () => {
                if (submitBtn.disabled) return
                send_message(node.id, textarea.value || '')
                submitBtn.disabled = true
                submitBtn.style.opacity = '0.4'
                submitBtn.style.cursor = 'default'
                statusEl.textContent = '✔ Submitted'
                statusEl.style.color = '#4ade80'
            })

            // ── Save / Load panel ───────────────────────────────────────────
            const slContainer = document.createElement('div')
            slContainer.style.cssText = 'padding:4px 6px 6px;display:flex;flex-direction:column;gap:5px;'

            const selStyle   = 'flex:1;min-width:60px;padding:4px 6px;border-radius:4px;border:1px solid rgba(255,255,255,0.15);background:transparent;color:inherit;font-size:11px;'
            const inputStyle = 'flex:1;min-width:60px;padding:4px 6px;border-radius:4px;border:1px solid rgba(255,255,255,0.15);background:transparent;color:inherit;font-size:11px;'
            const rowStyle   = 'display:flex;gap:4px;align-items:center;'
            const mkBtn = (_bg, extra='') =>
                `padding:4px 8px;border-radius:4px;background:rgba(255,255,255,0.08);color:inherit;border:1px solid rgba(255,255,255,0.15);cursor:pointer;font-size:11px;font-weight:600;white-space:nowrap;${extra}`

            // Search row
            const searchRow = document.createElement('div')
            searchRow.style.cssText = rowStyle
            const searchInput = document.createElement('input')
            searchInput.type = 'text'
            searchInput.placeholder = '🔍 Filter prompts…'
            searchInput.style.cssText = inputStyle + 'flex:1;'
            searchInput.title = 'Filter prompts by name (searches across all categories)'
            searchRow.appendChild(searchInput)

            // Load row
            const loadRow     = document.createElement('div')
            loadRow.style.cssText = rowStyle
            const loadCatSel  = document.createElement('select')
            loadCatSel.style.cssText = selStyle
            loadCatSel.title = 'Category'
            const loadNameSel = document.createElement('select')
            loadNameSel.style.cssText = selStyle
            loadNameSel.title = 'Prompt name'
            const loadBtn = document.createElement('button')
            loadBtn.type = 'button'
            loadBtn.textContent = 'Load'
            loadBtn.style.cssText = mkBtn('#6f42c1')
            loadBtn.title = 'Load selected prompt into the editor'
            loadRow.appendChild(loadCatSel)
            loadRow.appendChild(loadNameSel)
            loadRow.appendChild(loadBtn)

            // Preview box
            const previewBox = document.createElement('div')
            previewBox.style.cssText = [
                'display:none;padding:7px 9px;border-radius:4px;',
                'border:1px solid rgba(255,255,255,0.15);background:transparent;color:inherit;',
                'font-size:11px;line-height:1.5;min-height:48px;max-height:100px;',
                'overflow-y:auto;word-break:break-word;white-space:pre-wrap;',
            ].join('')
            previewBox.title = 'Preview of selected prompt'

            // Save row
            const saveRow = document.createElement('div')
            saveRow.style.cssText = rowStyle
            const saveCatInput = document.createElement('input')
            saveCatInput.type = 'text'
            saveCatInput.placeholder = 'Category'
            saveCatInput.style.cssText = inputStyle
            saveCatInput.title = 'Category to save into (existing ones auto-suggested)'
            saveCatInput.addEventListener('click', (e) => {
                e.stopPropagation()
                saveCatInput.value = ''
            })
            const catDatalist = document.createElement('datalist')
            catDatalist.id = `pv_catlist_${node.id}`
            saveCatInput.setAttribute('list', catDatalist.id)
            const saveNameInput = document.createElement('input')
            saveNameInput.type = 'text'
            saveNameInput.placeholder = 'Prompt name'
            saveNameInput.style.cssText = inputStyle
            saveNameInput.title = 'Name for this prompt'
            const saveBtn = document.createElement('button')
            saveBtn.type = 'button'
            saveBtn.textContent = 'Save'
            saveBtn.style.cssText = mkBtn('#0d6efd')
            saveBtn.title = 'Save current editor text as a named prompt'
            saveRow.appendChild(saveCatInput)
            saveRow.appendChild(saveNameInput)
            saveRow.appendChild(saveBtn)

            // Delete row
            const deleteRow = document.createElement('div')
            deleteRow.style.cssText = rowStyle
            const deleteBtn = document.createElement('button')
            deleteBtn.type = 'button'
            deleteBtn.textContent = '🗑 Delete selected'
            deleteBtn.style.cssText = mkBtn('#dc3545', 'flex:1;')
            deleteBtn.title = 'Permanently delete the currently selected prompt'
            deleteRow.appendChild(deleteBtn)

            // Rename category row
            const renameRow = document.createElement('div')
            renameRow.style.cssText = rowStyle
            const renameInput = document.createElement('input')
            renameInput.type = 'text'
            renameInput.placeholder = 'Rename category to…'
            renameInput.style.cssText = inputStyle
            renameInput.title = 'New name for the selected category'
            const renameBtn = document.createElement('button')
            renameBtn.type = 'button'
            renameBtn.textContent = 'Rename cat.'
            renameBtn.style.cssText = mkBtn('#fd7e14')
            renameBtn.title = 'Rename the currently selected category'
            renameRow.appendChild(renameInput)
            renameRow.appendChild(renameBtn)

            // Export / Import row
            const ioRow = document.createElement('div')
            ioRow.style.cssText = rowStyle
            const exportBtn = document.createElement('button')
            exportBtn.type = 'button'
            exportBtn.textContent = '⬇ Export'
            exportBtn.style.cssText = mkBtn('#20c997', 'flex:1;')
            exportBtn.title = 'Download your entire prompt library as a JSON file'
            const importLabel = document.createElement('label')
            importLabel.style.cssText = mkBtn('', 'flex:1;display:inline-block;text-align:center;box-sizing:border-box;')
            importLabel.textContent = '⬆ Import'
            importLabel.title = 'Merge a JSON prompt library file into the current one'
            const importInput = document.createElement('input')
            importInput.type = 'file'
            importInput.accept = '.json'
            importInput.style.cssText = 'display:none;'
            importLabel.appendChild(importInput)
            ioRow.appendChild(exportBtn)
            ioRow.appendChild(importLabel)

            // Status line
            const slStatus = document.createElement('div')
            slStatus.style.cssText = 'font-size:10px;min-height:13px;padding:0 2px;color:inherit;opacity:0.6;'

            slContainer.appendChild(searchRow)
            slContainer.appendChild(loadRow)
            slContainer.appendChild(previewBox)
            slContainer.appendChild(saveRow)
            slContainer.appendChild(catDatalist)
            slContainer.appendChild(deleteRow)
            slContainer.appendChild(renameRow)
            slContainer.appendChild(ioRow)
            slContainer.appendChild(slStatus)

            container.appendChild(slContainer)

            // ── Prompts data + helpers ──────────────────────────────────────
            let _promptsData = {}

            function setStatus(msg, color = '#aaa') {
                slStatus.textContent = msg
                slStatus.style.color = color
            }

            function updateCatDatalist() {
                catDatalist.innerHTML = ''
                Object.keys(_promptsData)
                    .filter(k => k !== '__meta__')
                    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
                    .forEach(c => {
                        const opt = document.createElement('option')
                        opt.value = c
                        catDatalist.appendChild(opt)
                    })
            }

            function updatePreview() {
                const cat  = loadCatSel.value
                const name = loadNameSel.value
                if (!cat || !name) { previewBox.style.display = 'none'; return }
                const entry = _promptsData[cat] && _promptsData[cat][name]
                if (!entry) { previewBox.style.display = 'none'; return }
                const text = typeof entry === 'string' ? entry : (entry.prompt || '')
                if (!text) { previewBox.style.display = 'none'; return }
                previewBox.textContent = text
                previewBox.style.display = 'block'
            }

            let _filterText = ''

            function populateLoadCat(data) {
                _promptsData = data
                const prev = loadCatSel.value
                loadCatSel.innerHTML = ''
                const cats = Object.keys(data)
                    .filter(k => k !== '__meta__')
                    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
                if (cats.length === 0) {
                    loadCatSel.innerHTML = '<option value="">— empty —</option>'
                    loadNameSel.innerHTML = ''
                    previewBox.style.display = 'none'
                    return
                }
                cats.forEach(c => {
                    const o = document.createElement('option')
                    o.value = c; o.textContent = c
                    o.style.color = 'black'
                    loadCatSel.appendChild(o)
                })
                loadCatSel.value = cats.includes(prev) ? prev : cats[0]
                populateLoadName(loadCatSel.value)
                updateCatDatalist()
            }

            function populateLoadName(cat) {
                const prev = loadNameSel.value
                loadNameSel.innerHTML = ''
                const catData = _promptsData[cat] || {}
                let names = Object.keys(catData)
                    .filter(k => k !== '__meta__')
                    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
                if (_filterText) names = names.filter(n => n.toLowerCase().includes(_filterText))
                if (names.length === 0) {
                    loadNameSel.innerHTML = '<option value="">— no results —</option>'
                    previewBox.style.display = 'none'
                    return
                }
                names.forEach(n => {
                    const o = document.createElement('option')
                    o.value = n; o.textContent = n
                    o.style.color = 'black'
                    loadNameSel.appendChild(o)
                })
                if (names.includes(prev)) loadNameSel.value = prev
                updatePreview()
            }

            searchInput.addEventListener('input', () => {
                _filterText = searchInput.value.trim().toLowerCase()
                if (loadCatSel.value) populateLoadName(loadCatSel.value)
            })

            loadCatSel.addEventListener('change', () => populateLoadName(loadCatSel.value))
            loadNameSel.addEventListener('change', () => updatePreview())

            function applyPrompts(data) { populateLoadCat(data) }

            async function refreshPrompts() {
                try {
                    const r = await fetch('/prompt_verify/get-prompts')
                    const j = await r.json()
                    if (j.success) applyPrompts(j.prompts)
                    else loadCatSel.innerHTML = '<option value="">— error —</option>'
                } catch(e) {
                    loadCatSel.innerHTML = '<option value="">— unavailable —</option>'
                }
            }
            refreshPrompts()

            // Load
            loadBtn.addEventListener('click', () => {
                const cat  = loadCatSel.value
                const name = loadNameSel.value
                if (!cat || !name) return
                const entry = _promptsData[cat] && _promptsData[cat][name]
                if (!entry) return
                const text = typeof entry === 'string' ? entry : (entry.prompt || '')
                const doLoad = () => {
                    textarea.value = text
                    if (nativeEditor) try { nativeEditor.value = text } catch(e) {}
                    setStatus(`Loaded: ${name}`, '#a78bfa')
                }
                if (textarea.value.trim() && textarea.value.trim() !== text.trim()) {
                    if (window.confirm(`Replace the current editor content with "${name}"?`)) doLoad()
                } else {
                    doLoad()
                }
            })

            // Save
            saveBtn.addEventListener('click', async () => {
                const category = saveCatInput.value.trim()
                const name     = saveNameInput.value.trim()
                const text     = textarea.value || ''
                if (!category || !name) { setStatus('Enter category and name first.', '#f87171'); return }
                if (!text.trim())       { setStatus('Cannot save an empty prompt.', '#f87171'); return }
                saveBtn.disabled = true
                setStatus('Saving…', '#aaa')
                try {
                    const r = await fetch('/prompt_verify/save-prompt', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ category, name, text })
                    })
                    const j = await r.json()
                    if (j.success) {
                        applyPrompts(j.prompts)
                        if (loadCatSel.querySelector(`option[value="${CSS.escape(category)}"]`)) {
                            loadCatSel.value = category
                            populateLoadName(category)
                            if (loadNameSel.querySelector(`option[value="${CSS.escape(name)}"]`)) {
                                loadNameSel.value = name; updatePreview()
                            }
                        }
                        setStatus(j.warning ? `Saved — ⚠ ${j.warning}` : `Saved: "${name}" in "${category}"`,
                                  j.warning ? '#facc15' : '#4ade80')
                        saveNameInput.value = ''
                    } else {
                        setStatus(j.error || 'Save failed.', '#f87171')
                    }
                } catch(e) { setStatus('Error: ' + e.message, '#f87171') }
                saveBtn.disabled = false
            })

            // Delete
            deleteBtn.addEventListener('click', async () => {
                const cat  = loadCatSel.value
                const name = loadNameSel.value
                if (!cat || !name) { setStatus('Select a prompt to delete.', '#f87171'); return }
                if (!window.confirm(`Delete "${name}" from "${cat}"? This cannot be undone.`)) return
                deleteBtn.disabled = true
                setStatus('Deleting…', '#aaa')
                try {
                    const r = await fetch('/prompt_verify/delete-prompt', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ category: cat, name })
                    })
                    const j = await r.json()
                    if (j.success) { applyPrompts(j.prompts); setStatus(`Deleted: "${name}"`, '#f87171') }
                    else setStatus(j.error || 'Delete failed.', '#f87171')
                } catch(e) { setStatus('Error: ' + e.message, '#f87171') }
                deleteBtn.disabled = false
            })

            // Rename category
            renameBtn.addEventListener('click', async () => {
                const oldName = loadCatSel.value
                const newName = renameInput.value.trim()
                if (!oldName) { setStatus('Select a category to rename.', '#f87171'); return }
                if (!newName) { setStatus('Enter a new category name.', '#f87171'); return }
                if (oldName === newName) { setStatus('New name is the same.', '#f87171'); return }
                if (!window.confirm(`Rename category "${oldName}" → "${newName}"?`)) return
                renameBtn.disabled = true
                setStatus('Renaming…', '#aaa')
                try {
                    const r = await fetch('/prompt_verify/rename-category', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ old_name: oldName, new_name: newName })
                    })
                    const j = await r.json()
                    if (j.success) {
                        applyPrompts(j.prompts)
                        if (loadCatSel.querySelector(`option[value="${CSS.escape(newName)}"]`)) {
                            loadCatSel.value = newName; populateLoadName(newName)
                        }
                        renameInput.value = ''
                        setStatus(`Renamed: "${oldName}" → "${newName}"`, '#4ade80')
                    } else { setStatus(j.error || 'Rename failed.', '#f87171') }
                } catch(e) { setStatus('Error: ' + e.message, '#f87171') }
                renameBtn.disabled = false
            })

            // Export
            exportBtn.addEventListener('click', async () => {
                try {
                    const r = await fetch('/prompt_verify/export')
                    if (!r.ok) { setStatus('Export failed.', '#f87171'); return }
                    const blob = await r.blob()
                    const url  = URL.createObjectURL(blob)
                    const a    = document.createElement('a')
                    a.href = url; a.download = 'prompt_verify_data.json'
                    document.body.appendChild(a); a.click()
                    document.body.removeChild(a); URL.revokeObjectURL(url)
                    setStatus('Exported successfully.', '#20c997')
                } catch(e) { setStatus('Export error: ' + e.message, '#f87171') }
            })

            // Import
            importInput.addEventListener('change', async () => {
                const file = importInput.files[0]
                if (!file) return
                importInput.value = ''
                let parsed
                try { parsed = JSON.parse(await file.text()) }
                catch(e) { setStatus('Import error: invalid JSON.', '#f87171'); return }
                setStatus('Importing…', '#aaa')
                try {
                    const r = await fetch('/prompt_verify/import', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(parsed)
                    })
                    const j = await r.json()
                    if (j.success) { applyPrompts(j.prompts); setStatus(`Imported: ${j.added} added, ${j.overwritten} updated.`, '#20c997') }
                    else setStatus(j.error || 'Import failed.', '#f87171')
                } catch(e) { setStatus('Import error: ' + e.message, '#f87171') }
            })

            // ── Register as single DOM widget, measure height via ResizeObserver
            // Compute the content height by summing the visible children's
            // heights. This yields a stable internal content measurement that
            // does not include the node chrome or outer layout which LiteGraph
            // applies when we call `node.setSize` (avoids feedback loops).
            const CHROME_PAD = 28
            function measureContentHeight() {
                try {
                    // Measure natural content height using a hidden clone
                    // appended to the document body. This avoids measuring the
                    // live container which may already be affected by the node's
                    // outer sizing and causes feedback loops.
                    const w = (container.clientWidth && container.clientWidth > 0) ? container.clientWidth : 300
                    const clone = container.cloneNode(true)
                    clone.style.width = w + 'px'
                    clone.style.position = 'absolute'
                    clone.style.visibility = 'hidden'
                    clone.style.pointerEvents = 'none'
                    clone.style.height = 'auto'
                    clone.style.maxHeight = 'none'
                    document.body.appendChild(clone)
                    const h = clone.scrollHeight || clone.offsetHeight || EDITOR_H
                    document.body.removeChild(clone)
                    return Math.max(Math.ceil(h), EDITOR_H)
                } catch (e) { return EDITOR_H }
            }

            // Provide dynamic min/max height functions so LiteGraph queries
            // the correct content height on demand. This avoids updating the
            // size reactively from a ResizeObserver which can cause feedback
            // loops and inconsistent sizing across reloads.
            const masterWidget = node.addDOMWidget('prompt_verify_master', 'div', container, {
                getValue() { return textarea.value },
                setValue(v) { textarea.value = v || ''; if (nativeEditor) try { nativeEditor.value = v || '' } catch(e) {} },
                getMinHeight() { return Math.max(EDITOR_H, measureContentHeight() + CHROME_PAD) },
                getMaxHeight() { return Math.max(EDITOR_H, measureContentHeight() + CHROME_PAD) },
            })

            // Apply a single initial size update after the DOM has settled so
            // the node chrome uses the correct dimensions. We measure using
            // a hidden clone above, so calling setSize once will stabilise the
            // layout without causing a feedback loop.
            setTimeout(() => {
                try { node.setSize(node.size) } catch (e) {}
            }, 220)

            // ── Remove the native editor from the widget list entirely so
            //    LiteGraph does not allocate space for it
            try {
                const idx = node.widgets.indexOf(nativeEditor)
                if (idx !== -1) node.widgets.splice(idx, 1)
            } catch(e) {}

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
