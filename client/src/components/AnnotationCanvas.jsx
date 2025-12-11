import { useRef, useEffect, useState, useCallback, forwardRef, useImperativeHandle } from 'react'
import { STAMPS } from './AnnotationToolbar'

const AnnotationCanvas = forwardRef(({
  width,
  height,
  tool,
  color,
  lineWidth,
  stamp,
  enabled,
  initialStrokes = [],
  onStrokesChange
}, ref) => {
  const canvasRef = useRef(null)
  const contextRef = useRef(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [strokes, setStrokes] = useState(initialStrokes)
  const currentStrokeRef = useRef(null)
  const lastPointRef = useRef(null)
  const isInitializedRef = useRef(false)

  // Expose methods to parent
  useImperativeHandle(ref, () => ({
    undo: () => {
      setStrokes(prev => {
        const newStrokes = prev.slice(0, -1)
        onStrokesChange?.(newStrokes)
        return newStrokes
      })
    },
    clear: () => {
      setStrokes([])
      onStrokesChange?.([])
    },
    getStrokes: () => strokes,
    hasStrokes: () => strokes.length > 0
  }))

  // Setup canvas once on mount
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || width === 0 || height === 0) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = height * dpr
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`

    const ctx = canvas.getContext('2d')
    ctx.scale(dpr, dpr)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    contextRef.current = ctx
    isInitializedRef.current = true

    // Draw initial strokes
    redrawStrokes(ctx, strokes, width, height)
  }, []) // Only run once on mount

  // Handle dimension changes
  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = contextRef.current
    if (!canvas || !ctx || !isInitializedRef.current) return
    if (width === 0 || height === 0) return

    const dpr = window.devicePixelRatio || 1

    // Only resize if dimensions actually changed
    const currentWidth = Math.round(canvas.width / dpr)
    const currentHeight = Math.round(canvas.height / dpr)

    if (currentWidth !== width || currentHeight !== height) {
      canvas.width = width * dpr
      canvas.height = height * dpr
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      ctx.scale(dpr, dpr)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
    }

    redrawStrokes(ctx, strokes, width, height)
  }, [width, height, strokes])

  const redrawStrokes = (ctx, strokeList, w, h) => {
    if (!ctx) return
    ctx.clearRect(0, 0, w, h)

    strokeList.forEach(stroke => {
      // Handle stamps
      if (stroke.tool === 'stamp') {
        const stampData = STAMPS.find(s => s.id === stroke.stampId)
        if (!stampData) return
        ctx.globalCompositeOperation = 'source-over'
        ctx.globalAlpha = 1
        ctx.fillStyle = stroke.color
        ctx.font = `${stroke.size || 24}px serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(stampData.symbol, stroke.x, stroke.y)
        return
      }

      if (!stroke.points || stroke.points.length < 2) return

      if (stroke.tool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out'
        ctx.globalAlpha = 1
        ctx.strokeStyle = 'rgba(0,0,0,1)'
      } else {
        ctx.globalCompositeOperation = stroke.tool === 'highlighter' ? 'multiply' : 'source-over'
        ctx.globalAlpha = stroke.tool === 'highlighter' ? 0.35 : 1
        ctx.strokeStyle = stroke.color
      }

      ctx.lineWidth = stroke.lineWidth
      ctx.beginPath()
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y)

      for (let i = 1; i < stroke.points.length - 1; i++) {
        const xc = (stroke.points[i].x + stroke.points[i + 1].x) / 2
        const yc = (stroke.points[i].y + stroke.points[i + 1].y) / 2
        ctx.quadraticCurveTo(stroke.points[i].x, stroke.points[i].y, xc, yc)
      }

      const last = stroke.points[stroke.points.length - 1]
      ctx.lineTo(last.x, last.y)
      ctx.stroke()
    })

    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  }

  const getPointerPos = useCallback((e) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()

    const clientX = e.touches ? e.touches[0].clientX : e.clientX
    const clientY = e.touches ? e.touches[0].clientY : e.clientY

    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    }
  }, [])

  const startDrawing = useCallback((e) => {
    if (!enabled) return
    e.preventDefault()
    e.stopPropagation()

    const pos = getPointerPos(e)

    // Handle stamp placement (single click)
    if (tool === 'stamp') {
      const stampStroke = {
        tool: 'stamp',
        stampId: stamp,
        color: '#1a1a1a',
        x: pos.x,
        y: pos.y,
        size: 28
      }
      setStrokes(prev => {
        const newStrokes = [...prev, stampStroke]
        onStrokesChange?.(newStrokes)
        return newStrokes
      })
      return
    }

    currentStrokeRef.current = {
      tool,
      color: tool === 'eraser' ? '#000000' : color,
      lineWidth: tool === 'highlighter' ? lineWidth * 3 : (tool === 'eraser' ? lineWidth * 4 : lineWidth),
      points: [pos]
    }
    lastPointRef.current = pos
    setIsDrawing(true)
  }, [enabled, tool, color, lineWidth, stamp, getPointerPos, onStrokesChange])

  const draw = useCallback((e) => {
    if (!isDrawing || !enabled || !currentStrokeRef.current) return
    e.preventDefault()
    e.stopPropagation()

    const pos = getPointerPos(e)
    const ctx = contextRef.current
    if (!ctx) return

    currentStrokeRef.current.points.push(pos)

    if (currentStrokeRef.current.tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out'
      ctx.globalAlpha = 1
      ctx.strokeStyle = 'rgba(0,0,0,1)'
    } else {
      ctx.globalCompositeOperation = currentStrokeRef.current.tool === 'highlighter' ? 'multiply' : 'source-over'
      ctx.globalAlpha = currentStrokeRef.current.tool === 'highlighter' ? 0.35 : 1
      ctx.strokeStyle = currentStrokeRef.current.color
    }

    ctx.lineWidth = currentStrokeRef.current.lineWidth
    ctx.beginPath()
    ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y)
    ctx.lineTo(pos.x, pos.y)
    ctx.stroke()

    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'

    lastPointRef.current = pos
  }, [isDrawing, enabled, getPointerPos])

  const stopDrawing = useCallback((e) => {
    if (!isDrawing || !currentStrokeRef.current) return
    e?.preventDefault?.()
    e?.stopPropagation?.()

    if (currentStrokeRef.current.points.length > 1) {
      const newStroke = currentStrokeRef.current
      setStrokes(prev => {
        const newStrokes = [...prev, newStroke]
        onStrokesChange?.(newStrokes)
        return newStrokes
      })
    }

    currentStrokeRef.current = null
    lastPointRef.current = null
    setIsDrawing(false)
  }, [isDrawing, onStrokesChange])

  // Touch events
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const options = { passive: false }

    const handleTouchStart = (e) => startDrawing(e)
    const handleTouchMove = (e) => draw(e)
    const handleTouchEnd = (e) => stopDrawing(e)

    canvas.addEventListener('touchstart', handleTouchStart, options)
    canvas.addEventListener('touchmove', handleTouchMove, options)
    canvas.addEventListener('touchend', handleTouchEnd, options)
    canvas.addEventListener('touchcancel', handleTouchEnd, options)

    return () => {
      canvas.removeEventListener('touchstart', handleTouchStart, options)
      canvas.removeEventListener('touchmove', handleTouchMove, options)
      canvas.removeEventListener('touchend', handleTouchEnd, options)
      canvas.removeEventListener('touchcancel', handleTouchEnd, options)
    }
  }, [startDrawing, draw, stopDrawing])

  return (
    <canvas
      ref={canvasRef}
      className={`annotation-canvas ${enabled ? 'annotation-canvas-active' : ''}`}
      onMouseDown={startDrawing}
      onMouseMove={draw}
      onMouseUp={stopDrawing}
      onMouseLeave={stopDrawing}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        pointerEvents: enabled ? 'auto' : 'none',
        touchAction: enabled ? 'none' : 'auto',
        cursor: enabled ? (tool === 'eraser' ? 'cell' : tool === 'stamp' ? 'copy' : 'crosshair') : 'default',
        zIndex: enabled ? 10 : 1
      }}
    />
  )
})

AnnotationCanvas.displayName = 'AnnotationCanvas'

export default AnnotationCanvas
