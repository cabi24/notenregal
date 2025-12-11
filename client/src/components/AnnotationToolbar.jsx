import { useState, useRef, useCallback, useEffect } from 'react'

const TOOLS = {
  pen: { icon: '✒', label: 'Pen' },
  highlighter: { icon: '🖍', label: 'Highlighter' },
  stamp: { icon: '✦', label: 'Stamp' },
  eraser: { icon: '🧽', label: 'Eraser' }
}

const STAMPS = [
  { id: 'fermata', symbol: '𝄐', label: 'Fermata' },
  { id: 'breath', symbol: '𝄒', label: 'Breath Mark' },
  { id: 'accent', symbol: '>', label: 'Accent' },
  { id: 'staccato', symbol: '•', label: 'Staccato' },
  { id: 'check', symbol: '✓', label: 'Check Mark' },
  { id: 'x', symbol: '✗', label: 'X Mark' },
  { id: 'star', symbol: '★', label: 'Star' },
  { id: 'circle', symbol: '○', label: 'Circle' }
]

const PEN_COLORS = [
  { id: 'black', color: '#1a1a1a', label: 'Black' },
  { id: 'blue', color: '#1e4a8a', label: 'Blue' },
  { id: 'red', color: '#8a1e1e', label: 'Red' },
  { id: 'white', color: '#ffffff', label: 'White (cover-up)' }
]

const HIGHLIGHTER_COLOR = { id: 'yellow', color: '#f5e642', label: 'Yellow' }

const LINE_WIDTHS = [
  { id: 'thin', width: 2, label: 'Thin' },
  { id: 'medium', width: 4, label: 'Medium' },
  { id: 'thick', width: 6, label: 'Thick' }
]

function AnnotationToolbar({
  enabled,
  onToggle,
  tool,
  onToolChange,
  color,
  onColorChange,
  lineWidth,
  onLineWidthChange,
  stamp,
  onStampChange,
  onUndo,
  canUndo
}) {
  const [position, setPosition] = useState({ x: 20, y: 80 })
  const [isDragging, setIsDragging] = useState(false)
  const dragOffset = useRef({ x: 0, y: 0 })
  const toolbarRef = useRef(null)

  const availableColors = tool === 'highlighter' ? [HIGHLIGHTER_COLOR] : PEN_COLORS
  const showColors = tool !== 'eraser' && tool !== 'stamp'
  const showStamps = tool === 'stamp'

  // Auto-select appropriate color when switching tools
  const handleToolChange = (newTool) => {
    onToolChange(newTool)
    if (newTool === 'highlighter') {
      onColorChange(HIGHLIGHTER_COLOR.color)
    } else if (newTool === 'pen' && (tool === 'highlighter' || tool === 'eraser')) {
      onColorChange(PEN_COLORS[0].color)
    }
  }

  const handleDragStart = useCallback((e) => {
    if (e.target.closest('button')) return // Don't drag when clicking buttons

    const clientX = e.touches ? e.touches[0].clientX : e.clientX
    const clientY = e.touches ? e.touches[0].clientY : e.clientY

    dragOffset.current = {
      x: clientX - position.x,
      y: clientY - position.y
    }
    setIsDragging(true)
    e.preventDefault()
  }, [position])

  const handleDrag = useCallback((e) => {
    if (!isDragging) return

    const clientX = e.touches ? e.touches[0].clientX : e.clientX
    const clientY = e.touches ? e.touches[0].clientY : e.clientY

    const newX = clientX - dragOffset.current.x
    const newY = clientY - dragOffset.current.y

    // Keep toolbar within viewport
    const toolbar = toolbarRef.current
    if (toolbar) {
      const rect = toolbar.getBoundingClientRect()
      const maxX = window.innerWidth - rect.width - 10
      const maxY = window.innerHeight - rect.height - 10

      setPosition({
        x: Math.max(10, Math.min(newX, maxX)),
        y: Math.max(10, Math.min(newY, maxY))
      })
    }
  }, [isDragging])

  const handleDragEnd = useCallback(() => {
    setIsDragging(false)
  }, [])

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleDrag)
      window.addEventListener('mouseup', handleDragEnd)
      window.addEventListener('touchmove', handleDrag, { passive: false })
      window.addEventListener('touchend', handleDragEnd)

      return () => {
        window.removeEventListener('mousemove', handleDrag)
        window.removeEventListener('mouseup', handleDragEnd)
        window.removeEventListener('touchmove', handleDrag)
        window.removeEventListener('touchend', handleDragEnd)
      }
    }
  }, [isDragging, handleDrag, handleDragEnd])

  // Don't render anything if not enabled
  if (!enabled) return null

  return (
    <div
      ref={toolbarRef}
      className={`annotation-toolbar-floating ${isDragging ? 'dragging' : ''}`}
      style={{
        left: position.x,
        top: position.y
      }}
      onMouseDown={handleDragStart}
      onTouchStart={handleDragStart}
    >
      <div className="annotation-toolbar-handle" title="Drag to move">
        ⋮⋮
      </div>
      <div className="annotation-tools">
          {/* Tool selector */}
          <div className="annotation-tool-group">
            {Object.entries(TOOLS).map(([toolId, { icon, label }]) => (
              <button
                key={toolId}
                className={`annotation-tool-btn ${tool === toolId ? 'active' : ''}`}
                onClick={() => handleToolChange(toolId)}
                title={label}
              >
                {icon}
              </button>
            ))}
          </div>

          {showColors && (
            <>
              <div className="annotation-divider" />

              {/* Color selector */}
              <div className="annotation-tool-group annotation-colors">
                {availableColors.map(({ id, color: c, label }) => (
                  <button
                    key={id}
                    className={`annotation-color-btn ${color === c ? 'active' : ''}`}
                    onClick={() => onColorChange(c)}
                    title={label}
                    style={{
                      '--swatch-color': c,
                      '--swatch-border': tool === 'highlighter' ? '#a09030' : (id === 'white' ? '#888' : c)
                    }}
                  >
                    <span className="color-swatch" />
                  </button>
                ))}
              </div>
            </>
          )}

          {showStamps && (
            <>
              <div className="annotation-divider" />

              {/* Stamp selector */}
              <div className="annotation-tool-group annotation-stamps">
                {STAMPS.map(({ id, symbol, label }) => (
                  <button
                    key={id}
                    className={`annotation-stamp-btn ${stamp === id ? 'active' : ''}`}
                    onClick={() => onStampChange(id)}
                    title={label}
                  >
                    {symbol}
                  </button>
                ))}
              </div>
            </>
          )}

          {!showStamps && (
            <>
              <div className="annotation-divider" />

              {/* Line width selector */}
              <div className="annotation-tool-group annotation-widths">
                {LINE_WIDTHS.map(({ id, width: w, label }) => (
                  <button
                    key={id}
                    className={`annotation-width-btn ${lineWidth === w ? 'active' : ''}`}
                    onClick={() => onLineWidthChange(w)}
                    title={label}
                  >
                    <span
                      className="width-indicator"
                      style={{ height: `${w + 2}px` }}
                    />
                  </button>
                ))}
              </div>
            </>
          )}

          <div className="annotation-divider" />

          {/* Actions */}
          <div className="annotation-tool-group annotation-actions">
            <button
              className="annotation-action-btn"
              onClick={onUndo}
              disabled={!canUndo}
              title="Undo last stroke"
            >
              ↩
            </button>
            <button
              className="annotation-action-btn annotation-close-btn"
              onClick={onToggle}
              title="Close annotation toolbar"
            >
              ✕
            </button>
          </div>
        </div>
    </div>
  )
}

export default AnnotationToolbar
export { STAMPS }
