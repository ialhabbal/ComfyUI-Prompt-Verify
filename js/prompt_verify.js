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
    const panelDefaults = msg.detail && msg.detail.panel_defaults ? msg.detail.panel_defaults : {}
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
            let _dragPointerId = null
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
                window.removeEventListener('pointercancel', onPointerUp)
                try { if (panel._prevTransition !== undefined) panel.style.transition = panel._prevTransition } catch(e){}
                try { if (_dragPointerId != null && handle.releasePointerCapture) handle.releasePointerCapture(_dragPointerId) } catch(e){}
                _dragPointerId = null
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
                try { if (ev.target && ev.target.setPointerCapture) { ev.target.setPointerCapture(ev.pointerId); _dragPointerId = ev.pointerId } } catch(e){}
                // disable transitions during interactive dragging for snappy movement
                try { panel._prevTransition = panel.style.transition; panel.style.transition = 'none' } catch(e){}
                dragging = true
                startX = ev.clientX != null ? ev.clientX : (ev.touches && ev.touches[0] && ev.touches[0].clientX)
                startY = ev.clientY != null ? ev.clientY : (ev.touches && ev.touches[0] && ev.touches[0].clientY)
                const rect = panel.getBoundingClientRect()
                startLeft = rect.left
                startTop = rect.top
                window.addEventListener('pointermove', onPointerMove)
                window.addEventListener('pointerup', onPointerUp)
                window.addEventListener('pointercancel', onPointerUp)
            })
    } catch(e) { console.debug('prompt_verify: makePanelDraggable failed', e) }
    }

    function makePanelResizable(panel, nodeId, textarea, panelDefaults) {
        try {
            const grip = document.createElement('div')
            grip.title = 'Resize'
            grip.style.cssText = 'position:absolute;right:6px;bottom:6px;width:18px;height:18px;border-radius:4px;background:rgba(255,255,255,0.04);cursor:se-resize;display:flex;align-items:center;justify-content:center;color:#ddd;font-size:12px;'
            grip.textContent = '◢'
            panel.appendChild(grip)

            let startX=0, startY=0, startW=0, startH=0, resizing=false
            let _resizePointerId = null
            const minW = (panelDefaults && typeof panelDefaults.min_w === 'number') ? panelDefaults.min_w : 320
            const minH = (panelDefaults && typeof panelDefaults.min_h === 'number') ? panelDefaults.min_h : 120
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
                        const padY = (panelDefaults && typeof panelDefaults.pad_y === 'number') ? panelDefaults.pad_y : 80 // space for buttons and padding
                        // textarea takes full width of panel, height reduced by controls
                        textarea.style.width = '100%'
                        textarea.style.height = `${Math.max(60, newH - padY)}px`
                    }
                } catch(e){}
            }
            const onPointerUp = (ev) => {
                if (!resizing) return
                resizing = false
                window.removeEventListener('pointermove', onPointerMove)
                window.removeEventListener('pointerup', onPointerUp)
                window.removeEventListener('pointercancel', onPointerUp)
                try { if (panel._prevTransition !== undefined) panel.style.transition = panel._prevTransition } catch(e){}
                try { if (_resizePointerId != null && grip.releasePointerCapture) grip.releasePointerCapture(_resizePointerId) } catch(e){}
                _resizePointerId = null
                // persist
                const rect = panel.getBoundingClientRect()
                savePanelSize(nodeId, rect.width, rect.height)
                // disable anchoring now that user explicitly resized
                try { if (panel._onrv) { window.removeEventListener('scroll', panel._onrv); window.removeEventListener('resize', panel._onrv); panel._onrv = null } } catch(e){}
                panel.dataset.anchored = '0'
            }

            grip.addEventListener('pointerdown', (ev)=>{
                ev.preventDefault()
                try { if (ev.target && ev.target.setPointerCapture) { ev.target.setPointerCapture(ev.pointerId); _resizePointerId = ev.pointerId } } catch(e){}
                // disable transition during interactive resize for snappy response
                try { panel._prevTransition = panel.style.transition; panel.style.transition = 'none' } catch(e){}
                resizing = true
                startX = ev.clientX != null ? ev.clientX : (ev.touches && ev.touches[0] && ev.touches[0].clientX)
                startY = ev.clientY != null ? ev.clientY : (ev.touches && ev.touches[0] && ev.touches[0].clientY)
                const rect = panel.getBoundingClientRect()
                startW = rect.width
                startH = rect.height
                window.addEventListener('pointermove', onPointerMove)
                window.addEventListener('pointerup', onPointerUp)
                window.addEventListener('pointercancel', onPointerUp)
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
    // make panel sizing fluid but constrained
    panel.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:999999;background:#111;padding:12px;border-radius:8px;box-shadow:0 8px 30px rgba(0,0,0,0.5);color:#fff;max-width:520px;box-sizing:border-box;'

        // --- Load Prompt section ---
        const loadRow = document.createElement('div')
        loadRow.style.cssText = 'display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:8px;'

        const loadCatSelect = document.createElement('select')
        loadCatSelect.style.cssText = 'flex:1;min-width:80px;padding:5px 7px;border-radius:5px;border:1px solid #444;background:#1a1a1a;color:#fff;font-size:12px;'

        const loadNameSelect = document.createElement('select')
        loadNameSelect.style.cssText = 'flex:2;min-width:120px;padding:5px 7px;border-radius:5px;border:1px solid #444;background:#1a1a1a;color:#fff;font-size:12px;'

        const loadBtn = document.createElement('button')
        loadBtn.type = 'button'
        loadBtn.textContent = 'Load'
        loadBtn.style.cssText = 'padding:5px 10px;border-radius:5px;background:#6f42c1;color:white;border:none;cursor:pointer;font-size:12px;font-weight:600;white-space:nowrap;'

        loadRow.appendChild(loadCatSelect)
        loadRow.appendChild(loadNameSelect)
        loadRow.appendChild(loadBtn)

        // Holds the fetched prompts data
        let _promptsData = {}

        function populateCatSelect(data) {
            _promptsData = data
            const cats = Object.keys(data).filter(k => k !== '__meta__').sort((a,b) => a.toLowerCase().localeCompare(b.toLowerCase()))
            loadCatSelect.innerHTML = ''
            if (cats.length === 0) {
                const opt = document.createElement('option')
                opt.value = ''
                opt.textContent = '— no categories —'
                loadCatSelect.appendChild(opt)
                loadNameSelect.innerHTML = ''
                return
            }
            cats.forEach(cat => {
                const opt = document.createElement('option')
                opt.value = cat
                opt.textContent = cat
                loadCatSelect.appendChild(opt)
            })
            populateNameSelect(cats[0])
        }

        function populateNameSelect(category) {
            loadNameSelect.innerHTML = ''
            const catData = _promptsData[category] || {}
            const names = Object.keys(catData).filter(k => k !== '__meta__').sort((a,b) => a.toLowerCase().localeCompare(b.toLowerCase()))
            if (names.length === 0) {
                const opt = document.createElement('option')
                opt.value = ''
                opt.textContent = '— empty —'
                loadNameSelect.appendChild(opt)
                return
            }
            names.forEach(name => {
                const opt = document.createElement('option')
                opt.value = name
                opt.textContent = name
                loadNameSelect.appendChild(opt)
            })
        }

        loadCatSelect.addEventListener('change', () => populateNameSelect(loadCatSelect.value))

        // Fetch prompts from server and populate dropdowns
        async function refreshPrompts() {
            try {
                const resp = await fetch('/prompt_verify/get-prompts')
                const result = await resp.json()
                if (result.success) {
                    populateCatSelect(result.prompts)
                } else {
                    loadCatSelect.innerHTML = '<option value="">— error loading —</option>'
                }
            } catch(e) {
                loadCatSelect.innerHTML = '<option value="">— unavailable —</option>'
            }
        }
        refreshPrompts()

        loadBtn.addEventListener('click', () => {
            const cat = loadCatSelect.value
            const name = loadNameSelect.value
            if (!cat || !name) return
            const entry = _promptsData[cat] && _promptsData[cat][name]
            if (!entry) return
            const text = typeof entry === 'string' ? entry : (entry.prompt || '')
            ta.value = text
            ta.dispatchEvent(new Event('input', { bubbles: true }))
            try { ta.focus() } catch(e){}
        })
        // --- end Load Prompt section ---

        const ta = document.createElement('textarea')
        // fluid textarea that wraps long words and will be auto-resized to content
        ta.style.cssText = 'width:100%;height:160px;padding:8px;border-radius:6px;border:1px solid #444;background:#0f0f0f;color:#fff;box-sizing:border-box;white-space:pre-wrap;word-break:break-word;overflow-wrap:break-word;resize:none;'
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.textContent = 'Submit'
        btn.style.cssText = 'margin-top:8px;margin-left:6px;padding:6px 10px;border-radius:6px;background:#28a745;color:white;border:none;cursor:pointer;font-weight:600;'
        const close = document.createElement('button')
        close.type = 'button'
        close.textContent = 'Close'
        close.style.cssText = 'margin-top:8px;margin-left:8px;padding:6px 10px;border-radius:6px;background:#6c757d;color:white;border:none;cursor:pointer;'

        // --- Save Prompt section ---
        const saveSep = document.createElement('hr')
        saveSep.style.cssText = 'border:none;border-top:1px solid #333;margin:10px 0 8px;'

        const saveRow = document.createElement('div')
        saveRow.style.cssText = 'display:flex;gap:6px;align-items:center;flex-wrap:wrap;'

        const catInput = document.createElement('input')
        catInput.type = 'text'
        catInput.placeholder = 'Category'
        catInput.style.cssText = 'flex:1;min-width:80px;padding:5px 7px;border-radius:5px;border:1px solid #444;background:#1a1a1a;color:#fff;font-size:12px;'

        const nameInput = document.createElement('input')
        nameInput.type = 'text'
        nameInput.placeholder = 'Prompt name'
        nameInput.style.cssText = 'flex:2;min-width:120px;padding:5px 7px;border-radius:5px;border:1px solid #444;background:#1a1a1a;color:#fff;font-size:12px;'

        const saveBtn = document.createElement('button')
        saveBtn.type = 'button'
        saveBtn.textContent = 'Save Prompt'
        saveBtn.style.cssText = 'padding:5px 10px;border-radius:5px;background:#0d6efd;color:white;border:none;cursor:pointer;font-size:12px;font-weight:600;white-space:nowrap;'

        const saveMsg = document.createElement('span')
        saveMsg.style.cssText = 'font-size:11px;margin-top:4px;width:100%;display:block;min-height:14px;'

        saveRow.appendChild(catInput)
        saveRow.appendChild(nameInput)
        saveRow.appendChild(saveBtn)

        saveBtn.addEventListener('click', async () => {
            const category = catInput.value.trim()
            const name = nameInput.value.trim()
            const text = ta.value
            if (!category || !name) {
                saveMsg.textContent = 'Please enter both a category and a name.'
                saveMsg.style.color = '#f87171'
                return
            }
            saveBtn.disabled = true
            saveMsg.textContent = 'Saving...'
            saveMsg.style.color = '#aaa'
            try {
                const resp = await fetch('/prompt_verify/save-prompt', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ category, name, text })
                })
                const result = await resp.json()
                if (result.success) {
                    saveMsg.textContent = `Saved as "${name}" in "${category}"`
                    saveMsg.style.color = '#4ade80'
                    nameInput.value = ''
                    // Refresh load dropdowns so the new prompt is immediately available
                    refreshPrompts()
                } else {
                    saveMsg.textContent = result.error || 'Save failed.'
                    saveMsg.style.color = '#f87171'
                }
            } catch(e) {
                saveMsg.textContent = 'Network error: ' + e.message
                saveMsg.style.color = '#f87171'
            }
            saveBtn.disabled = false
        })
        // --- end Save Prompt section ---

        panel.appendChild(loadRow)
        panel.appendChild(ta)
        panel.appendChild(document.createElement('br'))
        panel.appendChild(btn)
        panel.appendChild(close)
        panel.appendChild(saveSep)
        panel.appendChild(saveRow)
        panel.appendChild(saveMsg)
        document.body.appendChild(panel)
        // enable a subtle transition for moves/resizes (restorable when interacting)
        try { panel._defaultTransition = 'left 120ms ease, top 120ms ease, width 120ms ease, height 120ms ease'; panel.style.transition = panel._defaultTransition } catch(e){}
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

        // auto-resize textarea to content so panel fits the text on open
        function autoResizeTextarea() {
            try {
                ta.style.height = 'auto'
                // small extra offset so scrollHeight isn't clipped
                const h = Math.max(60, ta.scrollHeight + 2)
                ta.style.height = h + 'px'
            } catch(e){}
        }
        // live-update when user types
        ta.addEventListener('input', ()=>{
            autoResizeTextarea()
        })

        // restore saved size if present
        try {
            const savedSize = getSavedPanelSize(nodeId)
            if (savedSize) {
                panel.style.width = `${Math.max(200, savedSize.w)}px`
                panel.style.height = `${Math.max(120, savedSize.h)}px`
                console.debug('prompt_verify: restored saved panel size', {nodeId, savedSize})
            } else {
                // if no saved size, apply defaults from the node (if provided)
                try {
                    if (panelDefaults && typeof panelDefaults.w === 'number') panel.style.width = `${Math.max(200, panelDefaults.w)}px`
                    if (panelDefaults && typeof panelDefaults.h === 'number') panel.style.height = `${Math.max(120, panelDefaults.h)}px`
                    // if a default height was provided, make textarea match (respect pad)
                    try {
                        if (panelDefaults && typeof panelDefaults.h === 'number' && ta) {
                            const padY = (panelDefaults && typeof panelDefaults.pad_y === 'number') ? panelDefaults.pad_y : 80
                            ta.style.height = `${Math.max(60, panelDefaults.h - padY)}px`
                        }
                    } catch(e){}
                } catch(e){}
            }
        } catch(e){}

        // wire up resizer (pass textarea and panelDefaults so sizing/padding can be customized)
        try { makePanelResizable(panel, nodeId, ta, panelDefaults) } catch(e){}

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
            const val = ta.value
            send_message(nodeId, val)
            // Sync submitted text directly into the in-node editor widget.
            // We do this before panel.remove() so w.element is still alive,
            // and we write directly rather than going through receive_prompt_verify_request
            // to avoid any lazy-element timing issues.
            try {
                const node = app.graph && app.graph._nodes_by_id && app.graph._nodes_by_id[nodeId]
                if (node && node.widgets) {
                    let w = null
                    for (const widget of node.widgets) {
                        if (!widget) continue
                        if (widget.multiline) { w = widget; break }
                        if (widget.element && widget.element.tagName && widget.element.tagName.toLowerCase() === 'textarea') { w = widget; break }
                        if ((widget.name && widget.name.toLowerCase() === 'editor') || (widget.label && widget.label.toLowerCase() === 'editor')) { w = widget; break }
                    }
                    w = w || node.widgets[1] || node.widgets[2]
                    if (w) {
                        try { w.value = val } catch(e){}
                        if (w.element) {
                            try {
                                w.element.value = val
                                w.element.dispatchEvent(new Event('input', { bubbles: true }))
                            } catch(e){}
                        } else {
                            // element not present yet — store as pending so it flushes when it appears
                            node._prompt_verify_pending_text = val
                        }
                    }
                }
            } catch(e) { console.debug('prompt_verify: failed to sync text to in-node editor on submit', e) }
            try { panel.remove() } catch(e){}
        })
        close.addEventListener('click', ()=>{ try { panel.remove() } catch(e){} })
    }
    // set text into textarea and focus; if anchored, re-run positioning after render
    const ta = panel.querySelector('textarea')
    if (ta) {
        ta.value = msg.detail.message || '';
        // auto-size height to content and ensure textarea wraps long lines
        try { ta.style.height = 'auto'; ta.style.height = (ta.scrollHeight + 2) + 'px' } catch(e){}
        try { ta.focus() } catch(e){}
        // ensure panel width is not oversized when content is narrow
        try { panel.style.width = panel.style.width || 'auto' } catch(e){}
    }
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

                // Always set the widget's internal value so ComfyUI tracks it
                try { w.value = msg } catch (e) { console.error('prompt_verify: failed to set widget value', e) }

                // Helper: flush value into the live DOM textarea and trigger resize
                const flushToElement = (el) => {
                    try { el.disabled = false } catch(e){}
                    try {
                        el.value = msg
                        el.dispatchEvent(new Event('input', { bubbles: true }))
                    } catch(e) { console.error('prompt_verify: failed to update textarea element', e) }
                }

                if (w.element) {
                    // Element already exists — update it immediately
                    flushToElement(w.element)
                } else {
                    // Element doesn't exist yet (ComfyUI creates it lazily on focus/render).
                    // Store the pending text and watch for the element to appear via
                    // MutationObserver on the node's DOM container, then flush once it does.
                    this._prompt_verify_pending_text = msg
                    const nodeEl = this.element
                    if (nodeEl) {
                        const obs = new MutationObserver(() => {
                            const el = w.element
                            if (el) {
                                obs.disconnect()
                                flushToElement(el)
                                this._prompt_verify_pending_text = null
                            }
                        })
                        obs.observe(nodeEl, { childList: true, subtree: true })
                        // Also poll briefly as a fallback in case mutations are missed
                        let attempts = 0
                        const poll = setInterval(() => {
                            attempts++
                            if (w.element) {
                                clearInterval(poll)
                                obs.disconnect()
                                flushToElement(w.element)
                                this._prompt_verify_pending_text = null
                            } else if (attempts > 50) {
                                clearInterval(poll)
                                obs.disconnect()
                                console.warn('prompt_verify: textarea element never appeared for node', this.id)
                            }
                        }, 100)
                    }
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
            // --- find editor widget ---
            let editor = null
            try {
                for (const w of node.widgets) {
                    if (w && (w.multiline || (w.element && w.element.tagName && w.element.tagName.toLowerCase() === 'textarea'))) { editor = w; break }
                }
            } catch (e) { /* ignore */ }
            editor = editor || node.widgets[1] || node.widgets[2]

            if (editor) {
                // Attach keydown (Shift+Enter to submit) once element exists
                const attachKeydown = () => {
                    try { editor.element.addEventListener('keydown', node.handle_key.bind(node)) } catch(e){}
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

            // -----------------------------------------------------------------------
            // Build the in-node save/load DOM widget — placed at the TOP of the node
            // (inserted before all other widgets via reorderWidgets below)
            // -----------------------------------------------------------------------
            const container = document.createElement('div')
            container.style.cssText = 'padding:4px 6px 6px;display:flex;flex-direction:column;gap:5px;'

            // shared style helpers
            const selStyle = 'flex:1;min-width:60px;padding:4px 6px;border-radius:4px;border:1px solid #444;background:#1a1a1a;color:#fff;font-size:11px;'
            const inputStyle = 'flex:1;min-width:60px;padding:4px 6px;border-radius:4px;border:1px solid #444;background:#1a1a1a;color:#fff;font-size:11px;'
            const btnStyle = (bg) => `padding:4px 8px;border-radius:4px;background:${bg};color:white;border:none;cursor:pointer;font-size:11px;font-weight:600;white-space:nowrap;`
            const rowStyle = 'display:flex;gap:4px;align-items:center;'

            // --- Load row ---
            const loadRow = document.createElement('div')
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
            loadBtn.style.cssText = btnStyle('#6f42c1')
            loadBtn.title = 'Load selected prompt into editor'

            loadRow.appendChild(loadCatSel)
            loadRow.appendChild(loadNameSel)
            loadRow.appendChild(loadBtn)

            // --- Save row ---
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
            saveBtn.style.cssText = btnStyle('#0d6efd')
            saveBtn.title = 'Save editor text as a named prompt'

            saveRow.appendChild(saveCatInput)
            saveRow.appendChild(saveNameInput)
            saveRow.appendChild(saveBtn)

            // Status line
            const statusLine = document.createElement('div')
            statusLine.style.cssText = 'font-size:10px;min-height:13px;padding:0 2px;'

            container.appendChild(loadRow)
            container.appendChild(saveRow)
            container.appendChild(statusLine)

            // --- Prompts data cache ---
            let _promptsData = {}

            function populateLoadCat(data) {
                _promptsData = data
                const prev = loadCatSel.value
                loadCatSel.innerHTML = ''
                const cats = Object.keys(data).filter(k => k !== '__meta__').sort((a,b) => a.toLowerCase().localeCompare(b.toLowerCase()))
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
                const names = Object.keys(catData).filter(k => k !== '__meta__').sort((a,b) => a.toLowerCase().localeCompare(b.toLowerCase()))
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
                const cat = loadCatSel.value
                const name = loadNameSel.value
                if (!cat || !name) return
                const entry = _promptsData[cat] && _promptsData[cat][name]
                if (!entry) return
                const text = typeof entry === 'string' ? entry : (entry.prompt || '')
                // write into editor widget (same path as the proven submit sync)
                if (editor) {
                    try { editor.value = text } catch(e){}
                    if (editor.element) {
                        try {
                            editor.element.value = text
                            editor.element.dispatchEvent(new Event('input', { bubbles: true }))
                        } catch(e){}
                    } else {
                        node._prompt_verify_pending_text = text
                    }
                }
                statusLine.textContent = `Loaded: ${name}`
                statusLine.style.color = '#a78bfa'
            })

            // Save button — save current editor text
            saveBtn.addEventListener('click', async () => {
                const category = saveCatInput.value.trim()
                const name = saveNameInput.value.trim()
                const text = editor ? editor.value : ''
                if (!category || !name) {
                    statusLine.textContent = 'Enter category and name first.'
                    statusLine.style.color = '#f87171'
                    return
                }
                saveBtn.disabled = true
                statusLine.textContent = 'Saving...'
                statusLine.style.color = '#aaa'
                try {
                    const r = await fetch('/prompt_verify/save-prompt', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ category, name, text })
                    })
                    const j = await r.json()
                    if (j.success) {
                        statusLine.textContent = `Saved: "${name}" in "${category}"`
                        statusLine.style.color = '#4ade80'
                        saveNameInput.value = ''
                        refreshPrompts()
                    } else {
                        statusLine.textContent = j.error || 'Save failed.'
                        statusLine.style.color = '#f87171'
                    }
                } catch(e) {
                    statusLine.textContent = 'Error: ' + e.message
                    statusLine.style.color = '#f87171'
                }
                saveBtn.disabled = false
            })

            // Add as a DOM widget. ComfyUI appends it at the end of the widgets list.
            // naturalH starts as a safe overestimate; after the first paint we measure
            // the real scrollHeight and lock getMinHeight/getMaxHeight to that value.
            container.style.overflow = 'hidden'
            let naturalH = 108

            const saveLoadWidget = node.addDOMWidget('prompt_verify_save_load', 'div', container, {
                getValue() { return null },
                setValue() {},
                getMinHeight() { return naturalH },
                getMaxHeight() { return naturalH },
            })

            // After the first paint, measure the true rendered height and lock to it.
            requestAnimationFrame(() => {
                try {
                    container.style.height = 'auto'
                    const measured = container.scrollHeight
                    if (measured > 0) {
                        naturalH = measured + 16
                        container.style.height = naturalH + 'px'
                        node.setSize(node.size)
                    }
                } catch(e) {}
            })

            // --- Reorder: place saveLoadWidget right after the editor widget,
            // just above panel_default_width. Sandwiched between non-DOM widgets on
            // both sides, ComfyUI cannot give it unbounded expanding space.
            try {
                const editorIdx = node.widgets.findIndex(w => w && w.name === 'editor')
                const slIdx = node.widgets.indexOf(saveLoadWidget)
                if (slIdx !== -1) {
                    node.widgets.splice(slIdx, 1)
                    const insertAt = editorIdx !== -1 ? editorIdx + 1 : 0
                    node.widgets.splice(insertAt, 0, saveLoadWidget)
                }
            } catch(e) { console.debug('prompt_verify: could not reorder save/load widget', e) }

            node._prompt_verify_submit_button = { disabled: false }  // satisfy any existing references
        }
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
