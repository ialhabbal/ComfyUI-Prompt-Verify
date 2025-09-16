import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

// Migrate legacy localStorage keys used by earlier versions to the new keys.
// This migration is destructive: it copies legacy values to the new keys,
// sets a one-time marker `prompt_verify_migrated`, and removes the legacy
// keys so they don't linger in localStorage.
function migrateLocalStorage() {
    try {
        if (typeof localStorage === 'undefined') return
        // one-time migration marker
        if (localStorage.getItem('prompt_verify_migrated') === '1') return

        const legacyPrefixes = [
            'prompt_verify_float_pos_',
            'prompt_verify_float_size_',
        ]

        const keysToDelete = []

        for (const key of Object.keys(localStorage)) {
            try {
                for (const p of legacyPrefixes) {
                    if (key.startsWith(p)) {
                        const nodeId = key.split('_').pop()
                        const newKey = p.includes('pos') ? `prompt_verify_float_pos_${nodeId}` : `prompt_verify_float_size_${nodeId}`

                        if (!localStorage.getItem(newKey)) {
                            const v = localStorage.getItem(key)
                            if (v) localStorage.setItem(newKey, v)
                        }

                        keysToDelete.push(key)
                        break
                    }
                }
            } catch(e) { /* ignore individual key errors */ }
        }

        try { localStorage.setItem('prompt_verify_migrated', '1') } catch(e) {}

        for (const k of keysToDelete) {
            try { localStorage.removeItem(k) } catch(e) {}
        }
    } catch(e) { /* ignore when localStorage is unavailable */ }
}

// small toast helper retained for compatibility but suppressed by default.
// This no-op preserves the function and call sites so behavior is unchanged
// except that toasts won't appear. To restore the original toast behavior,
// revert this function to the previous implementation.
function showToast(msg, timeout=4000) {
    try {
        // Intentionally no visual toast. Keep a debug log so developers
        // can still see that the event would have fired.
    console.debug('prompt_verify: toast suppressed (message):', msg)
    } catch(e) { /* swallow errors to avoid breaking node behavior */ }
}

function send_message(node_id, message) {
    const body = new FormData();
    body.append('message',message);
    body.append('node_id',node_id);
    api.fetchApi("/prompt_verify_response", { method: "POST", body, });
}

function prompt_verify_request(msg) {
    console.debug('prompt_verify: received prompt_verify_request', msg.detail)
    const nodeId = msg.detail.node_id
    const timeup = !!msg.detail.timeup
    // create or find floating editor for this node id
    const floatId = `prompt_verify_float_${nodeId}`
    let panel = document.getElementById(floatId)
    if (timeup) {
        // if timeup, auto-submit current value then remove panel
        if (panel) {
            const ta = panel.querySelector('textarea')
            const val = ta ? ta.value : ''
            send_message(nodeId, val)
            panel.remove()
        } else {
            // no panel; still send empty message
            send_message(nodeId, '')
        }
        return
    }

    function positionPanelNearNode(panel, nodeId) {
        try {
            const node = app.graph._nodes_by_id[nodeId]
            console.debug('prompt_verify: trying to anchor panel', {nodeId, nodeExists: !!node, hasElement: !!(node && node.element)})
            if (!node || !node.element) return false
            const rect = node.element.getBoundingClientRect()
            const panelW = panel.offsetWidth || 480
            const panelH = panel.offsetHeight || 200
            // preferred position: below the node (use fixed positioning relative to viewport)
            let left = rect.left
            let top = rect.top + rect.height + 8
            // if overflowing bottom, place above node
            if (top + panelH > window.innerHeight) {
                top = rect.top - panelH - 8
            }
            // clamp horizontally
            if (left + panelW > window.innerWidth) {
                left = Math.max(8, window.innerWidth - panelW - 8)
            }
            panel.style.position = 'fixed'
            panel.style.left = `${Math.max(8, left)}px`
            panel.style.top = `${Math.max(8, top)}px`
            panel.style.right = 'auto'
            panel.style.bottom = 'auto'
            panel.dataset.anchored = '1'
            console.debug('prompt_verify: anchored panel', {left: panel.style.left, top: panel.style.top, panelW, panelH, rect})
            return true
        } catch(e) { return false }
    }

    // helpers to persist user-moved panel position per node (non-destructive)
    function getSavedPanelPos(nodeId) {
        try {
            const raw = localStorage.getItem(`prompt_verify_float_pos_${nodeId}`)
            if (!raw) return null
            const obj = JSON.parse(raw)
            if (typeof obj.left === 'number' && typeof obj.top === 'number') return obj
        } catch(e) { /* ignore */ }
        return null
    }
    function savePanelPos(nodeId, left, top) {
    try { localStorage.setItem(`prompt_verify_float_pos_${nodeId}`, JSON.stringify({left, top})) } catch(e){}
    }
    // per-node persisted size (non-destructive)
    function getSavedPanelSize(nodeId) {
        try {
            const raw = localStorage.getItem(`prompt_verify_float_size_${nodeId}`)
            if (!raw) return null
            const obj = JSON.parse(raw)
            if (typeof obj.w === 'number' && typeof obj.h === 'number') return obj
        } catch(e) { /* ignore */ }
        return null
    }
    function savePanelSize(nodeId, w, h) {
    try { localStorage.setItem(`prompt_verify_float_size_${nodeId}`, JSON.stringify({w, h})) } catch(e){}
    }
    function makePanelDraggable(panel, nodeId) {
        try {
            // add a small drag handle to avoid interfering with textarea selection
            const handle = document.createElement('div')
            handle.title = 'Drag to move'
            // slightly larger handle for easier grabbing; keep visual subtlety
            handle.style.cssText = 'position:absolute;top:8px;right:8px;width:26px;height:26px;border-radius:6px;background:rgba(255,255,255,0.06);color:#ddd;display:flex;align-items:center;justify-content:center;cursor:move;font-size:14px;user-select:none;'
            handle.textContent = '≡'
            handle.setAttribute('role','button')
            handle.setAttribute('aria-label','Move panel')
            handle.tabIndex = 0
            panel.style.position = panel.style.position || 'fixed'
            panel.style.boxSizing = 'border-box'
            panel.appendChild(handle)

            let startX=0, startY=0, startLeft=0, startTop=0, dragging=false
            const onPointerMove = (ev) => {
                if (!dragging) return
                const clientX = ev.clientX != null ? ev.clientX : (ev.touches && ev.touches[0] && ev.touches[0].clientX)
                const clientY = ev.clientY != null ? ev.clientY : (ev.touches && ev.touches[0] && ev.touches[0].clientY)
                if (clientX == null || clientY == null) return
                const dx = clientX - startX
                const dy = clientY - startY
                const left = Math.max(8, startLeft + dx)
                const top = Math.max(8, startTop + dy)
                panel.style.left = `${left}px`
                panel.style.top = `${top}px`
                panel.style.right = 'auto'
                panel.style.bottom = 'auto'
            }
            const onPointerUp = (ev) => {
                if (!dragging) return
                dragging = false
                window.removeEventListener('pointermove', onPointerMove)
                window.removeEventListener('pointerup', onPointerUp)
                // save position
                const left = parseInt(panel.style.left,10) || panel.getBoundingClientRect().left
                const top = parseInt(panel.style.top,10) || panel.getBoundingClientRect().top
                savePanelPos(nodeId, left, top)
                // if anchored, remove anchoring so user position persists
                try { if (panel._onrv) { window.removeEventListener('scroll', panel._onrv); window.removeEventListener('resize', panel._onrv); panel._onrv = null } } catch(e){}
                panel.dataset.anchored = '0'
            }

            handle.addEventListener('pointerdown', (ev)=>{
                ev.preventDefault()
                dragging = true
                startX = ev.clientX != null ? ev.clientX : (ev.touches && ev.touches[0] && ev.touches[0].clientX)
                startY = ev.clientY != null ? ev.clientY : (ev.touches && ev.touches[0] && ev.touches[0].clientY)
                const rect = panel.getBoundingClientRect()
                startLeft = rect.left
                startTop = rect.top
                window.addEventListener('pointermove', onPointerMove)
                window.addEventListener('pointerup', onPointerUp)
            })
    } catch(e) { console.debug('prompt_verify: makePanelDraggable failed', e) }
    }

    function makePanelResizable(panel, nodeId, textarea) {
        try {
            const grip = document.createElement('div')
            grip.title = 'Resize'
            grip.style.cssText = 'position:absolute;right:6px;bottom:6px;width:18px;height:18px;border-radius:4px;background:rgba(255,255,255,0.04);cursor:se-resize;display:flex;align-items:center;justify-content:center;color:#ddd;font-size:12px;'
            grip.textContent = '◢'
            panel.appendChild(grip)

            let startX=0, startY=0, startW=0, startH=0, resizing=false
            const minW = 320, minH = 120
            const onPointerMove = (ev) => {
                if (!resizing) return
                const clientX = ev.clientX != null ? ev.clientX : (ev.touches && ev.touches[0] && ev.touches[0].clientX)
                const clientY = ev.clientY != null ? ev.clientY : (ev.touches && ev.touches[0] && ev.touches[0].clientY)
                if (clientX == null || clientY == null) return
                let newW = Math.max(minW, startW + (clientX - startX))
                let newH = Math.max(minH, startH + (clientY - startY))
                // clamp to viewport
                newW = Math.min(newW, Math.max(200, window.innerWidth - 16))
                newH = Math.min(newH, Math.max(100, window.innerHeight - 16))
                panel.style.width = `${newW}px`
                panel.style.height = `${newH}px`
                panel.style.right = 'auto'
                panel.style.bottom = 'auto'
                // update textarea to fill available space (approx)
                try {
                    if (textarea) {
                        const padX = 24 // approximate horizontal padding/margins
                        const padY = 80 // space for buttons and padding
                        textarea.style.width = `${Math.max(100, newW - padX)}px`
                        textarea.style.height = `${Math.max(60, newH - padY)}px`
                    }
                } catch(e){}
            }
            const onPointerUp = (ev) => {
                if (!resizing) return
                resizing = false
                window.removeEventListener('pointermove', onPointerMove)
                window.removeEventListener('pointerup', onPointerUp)
                // persist
                const rect = panel.getBoundingClientRect()
                savePanelSize(nodeId, rect.width, rect.height)
                // disable anchoring now that user explicitly resized
                try { if (panel._onrv) { window.removeEventListener('scroll', panel._onrv); window.removeEventListener('resize', panel._onrv); panel._onrv = null } } catch(e){}
                panel.dataset.anchored = '0'
            }

            grip.addEventListener('pointerdown', (ev)=>{
                ev.preventDefault()
                resizing = true
                startX = ev.clientX != null ? ev.clientX : (ev.touches && ev.touches[0] && ev.touches[0].clientX)
                startY = ev.clientY != null ? ev.clientY : (ev.touches && ev.touches[0] && ev.touches[0].clientY)
                const rect = panel.getBoundingClientRect()
                startW = rect.width
                startH = rect.height
                window.addEventListener('pointermove', onPointerMove)
                window.addEventListener('pointerup', onPointerUp)
            })

            // when textarea exists, disable its native resize to avoid double-resize UI
            if (textarea) {
                try { textarea.style.resize = 'none' } catch(e){}
            }
    } catch(e) { console.debug('prompt_verify: makePanelResizable failed', e) }
    }

    if (!panel) {
        panel = document.createElement('div')
        panel.id = floatId
    panel.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:999999;background:#111;padding:12px;border-radius:8px;box-shadow:0 8px 30px rgba(0,0,0,0.5);color:#fff;max-width:520px;'
        const ta = document.createElement('textarea')
        ta.style.cssText = 'width:480px;height:160px;padding:8px;border-radius:6px;border:1px solid #444;background:#0f0f0f;color:#fff;resize:vertical;'
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.textContent = 'Submit'
        btn.style.cssText = 'margin-top:8px;margin-left:6px;padding:6px 10px;border-radius:6px;background:#28a745;color:white;border:none;cursor:pointer;font-weight:600;'
        const close = document.createElement('button')
        close.type = 'button'
        close.textContent = 'Close'
        close.style.cssText = 'margin-top:8px;margin-left:8px;padding:6px 10px;border-radius:6px;background:#6c757d;color:white;border:none;cursor:pointer;'
        panel.appendChild(ta)
        panel.appendChild(document.createElement('br'))
        panel.appendChild(btn)
        panel.appendChild(close)
        document.body.appendChild(panel)
        // if user previously moved this node's panel, restore that position (non-destructive)
        try {
            const saved = getSavedPanelPos(nodeId)
            if (saved) {
                panel.style.position = 'fixed'
                panel.style.left = `${Math.max(8, saved.left)}px`
                panel.style.top = `${Math.max(8, saved.top)}px`
                panel.style.right = 'auto'
                panel.style.bottom = 'auto'
                panel.dataset.anchored = '0'
                console.debug('prompt_verify: restored saved panel pos', {nodeId, saved})
            }
        } catch(e) { /* ignore */ }

        // make panel draggable so user can move it; movement will clear anchoring
        try { makePanelDraggable(panel, nodeId) } catch(e){ }

        // restore saved size if present
        try {
            const savedSize = getSavedPanelSize(nodeId)
            if (savedSize) {
                panel.style.width = `${Math.max(200, savedSize.w)}px`
                panel.style.height = `${Math.max(120, savedSize.h)}px`
                console.debug('prompt_verify: restored saved panel size', {nodeId, savedSize})
            }
        } catch(e){}

        // wire up resizer (pass textarea so it can be resized accordingly)
        try { makePanelResizable(panel, nodeId, ta) } catch(e){}

        // try to position near node; if success, keep fixed placement (unless user had saved pos)
    const anchored = (!panel.dataset.anchored || panel.dataset.anchored!=='0') && positionPanelNearNode(panel, nodeId)
        if (anchored) {
            // re-position on scroll/resize so it stays with node viewport
            const onrv = () => positionPanelNearNode(panel, nodeId)
            window.addEventListener('scroll', onrv, {passive:true})
            window.addEventListener('resize', onrv)
            // store to allow cleanup if panel removed
            panel._onrv = onrv
        } else {
            console.debug('prompt_verify: anchor failed, using bottom-right fallback')
        }

        btn.addEventListener('click', ()=>{
            send_message(nodeId, ta.value)
            try { panel.remove() } catch(e){}
        })
        close.addEventListener('click', ()=>{ try { panel.remove() } catch(e){} })
    }
    // set text into textarea and focus; if anchored, re-run positioning after render
    const ta = panel.querySelector('textarea')
    if (ta) { ta.value = msg.detail.message || ''; ta.focus(); }
    if (panel.dataset.anchored === '1') positionPanelNearNode(panel, nodeId)
}

function registerWithApp(app) {
    try { console.debug('prompt_verify: registering extension with app') } catch(e){}
    app.registerExtension({
        name: "prompt_verify",
        async beforeRegisterNodeDef(nodeType, nodeData, app) {
    if (nodeType?.comfyClass==="Prompt Verify") {
            // helper to find the multiline editor widget more robustly
            function findEditorWidget(node) {
                if (!node || !node.widgets) return null
                // heuristics: prefer widget flagged multiline or a textarea element
                for (const w of node.widgets) {
                    try {
                        if (!w) continue
                        // direct multiline flag
                        if (w.multiline) return w
                        // element looks like textarea
                        if (w.element && w.element.tagName && w.element.tagName.toLowerCase() === 'textarea') return w
                        // named "editor" or labelled "editor"
                        if ((w.name && w.name.toLowerCase() === 'editor') || (w.label && w.label.toLowerCase() === 'editor')) return w
                        // common fallback: any widget with a value and an element
                        if (w.element && ('value' in w)) return w
                    } catch (e) { /* ignore */ }
                }
                // fallback to the 3rd widget (legacy behavior)
                return node.widgets[2] || null
            }

            nodeType.prototype.receive_prompt_verify_request = function(msg) {
                console.debug(`prompt_verify: node ${this.id} receive_prompt_verify_request`, {msg, widgets: this.widgets})
                const w = findEditorWidget(this)
                if (!w) return console.warn('Prompt Verify: editor widget not found', {nodeId: this.id, widgets: this.widgets})
                try { w.value = msg } catch (e) { console.error('prompt_verify: failed to set widget value', e) }
                if (w.element) {
                    try { w.element.disabled = false } catch(e){}
                }
                // enable submit button if present
                try {
                    if (this._prompt_verify_submit_button) this._prompt_verify_submit_button.disabled = false
                } catch(e){}
            }
            nodeType.prototype.receive_prompt_verify_timeup = function() {
                const w = findEditorWidget(this)
                if (!w) return console.warn('Prompt Verify: editor widget not found')
                send_message(this.id, w.value)
                try {
                    if (this._prompt_verify_submit_button) this._prompt_verify_submit_button.disabled = true
                } catch(e){}
            }
            nodeType.prototype.handle_key = function(e) {
                if (e.key == 'Enter' && e.shiftKey) {
                    const w = findEditorWidget(this)
                    if (!w) return
                    send_message(this.id, w.value)
                }
            }
    }
    },
    async nodeCreated(node) {
    if (node.receive_prompt_verify_request) {
            // try to find the editor widget for this instance
            let editor = null
            try {
                for (const w of node.widgets) {
                    if (w && (w.multiline || (w.element && w.element.tagName && w.element.tagName.toLowerCase() === 'textarea'))) { editor = w; break }
                }
            } catch (e) { /* ignore */ }
            editor = editor || node.widgets[2]
            if (editor && editor.element) {
                try { editor.element.addEventListener('keydown', node.handle_key.bind(node)) } catch(e){}
                // create a Submit button next to the editor widget
                try {
                    const createAndInsertButton = () => {
                        const btn = document.createElement('button')
                        btn.type = 'button'
                        btn.textContent = 'Submit'
                        btn.style.cssText = 'margin-left:6px; display:inline-block; vertical-align:middle;'
                        btn.className = 'prompt-verify-submit'
                        btn.disabled = true
                        btn.addEventListener('click', function(e){
                            try {
                                send_message(node.id, editor.value)
                            } catch(err) { console.error('prompt_verify: submit click failed', err) }
                            try { btn.disabled = true } catch(e){}
                        })
                        // try insert after the editor element
                        try {
                            if (editor.element && editor.element.insertAdjacentElement) {
                                editor.element.insertAdjacentElement('afterend', btn)
                            } else if (editor.element && editor.element.parentElement) {
                                editor.element.parentElement.appendChild(btn)
                            } else if (node.element && node.element.appendChild) {
                                node.element.appendChild(btn)
                            } else {
                                document.body.appendChild(btn)
                            }
                        } catch (ie) {
                            // last resort append to body
                            try { document.body.appendChild(btn) } catch(e){}
                        }
                        node._prompt_verify_submit_button = btn
                        console.debug('prompt_verify: submit button created for node', node.id)
                        showToast('Prompt Verify: Submit button added')
                    }

                    if (!editor.element) {
                        // sometimes element not yet present - retry a few times
                        let attempts = 0
                        const rid = setInterval(()=>{
                            attempts++
                            if (editor.element) {
                                clearInterval(rid)
                                createAndInsertButton()
                            } else if (attempts>10) {
                                clearInterval(rid)
                                console.warn('prompt_verify: editor.element never appeared, submit button not created for node', node.id)
                            }
                        }, 100)
                    } else {
                        createAndInsertButton()
                    }
                } catch(e) { console.error('prompt_verify: failed to create submit button', e) }
            }
            }
            // fallback: if no submit button was created by the widget-specific logic, add one to the node header
            try {
                if (!node._prompt_verify_submit_button) {
                    const tryCreateFallback = () => {
                        if (!node || node._prompt_verify_submit_button) return true
                        if (!node.element) return false
                        try {
                            const fallbackBtn = document.createElement('button')
                            fallbackBtn.type = 'button'
                            fallbackBtn.textContent = 'Submit'
                            fallbackBtn.style.cssText = 'margin-left:6px; display:inline-block; vertical-align:middle; background:#4caf50; color:white; border:none; padding:6px 10px; border-radius:6px; cursor:pointer; font-weight:600;'
                            fallbackBtn.className = 'prompt-verify-submit prompt-verify-submit-fallback'
                            fallbackBtn.disabled = true
                            fallbackBtn.addEventListener('click', function(){
                                // find editor widget at click time
                                let editorWidget = null
                                try {
                                    for (const w of node.widgets) {
                                        if (w && (w.multiline || (w.element && w.element.tagName && w.element.tagName.toLowerCase() === 'textarea'))) { editorWidget = w; break }
                                    }
                                } catch(e) {}
                                editorWidget = editorWidget || node.widgets[2]
                                const val = (editorWidget && ('value' in editorWidget)) ? editorWidget.value : ''
                                try { send_message(node.id, val) } catch(e){ console.error('prompt_verify: fallback submit failed', e) }
                                try { fallbackBtn.disabled = true } catch(e){}
                            })
                            const header = node.element.querySelector('.node-header') || node.element
                            header.appendChild(fallbackBtn)
                            node._prompt_verify_submit_button = fallbackBtn
                            console.debug('prompt_verify: fallback submit button created for node', node.id)
                            showToast('Prompt Verify: Submit button added')
                            return true
                        } catch(e) {
                            console.error('prompt_verify: failed to append fallback submit button', e)
                            return true
                        }
                    }

                    let attempts = 0
                    const fid = setInterval(()=>{
                        attempts++
                        const done = tryCreateFallback()
                        if (done || attempts>20) clearInterval(fid)
                    }, 200)
                }
            } catch(e) { /* ignore */ }
        },
        setup() {
            // migrate any legacy localStorage keys first
            try { migrateLocalStorage() } catch(e) {}
            api.addEventListener("prompt_verify_request", prompt_verify_request);
        }
    })
}

// Register immediately using imported `app`.
try {
    registerWithApp(app)
} catch (e) {
    console.error('prompt_verify: failed to register extension', e)
}
