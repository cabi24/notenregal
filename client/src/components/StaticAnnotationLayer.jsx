import { useRef, useEffect } from 'react'
import { STAMPS } from './AnnotationToolbar'

// A read-only canvas that renders strokes without any interaction
function StaticAnnotationLayer({ width, height, strokes = [] }) {
  const canvasRef = useRef(null)

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

    // Clear and redraw
    ctx.clearRect(0, 0, width, height)

    strokes.forEach(stroke => {
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
  }, [width, height, strokes])

  if (strokes.length === 0) return null

  return (
    <canvas
      ref={canvasRef}
      className="static-annotation-layer"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        pointerEvents: 'none',
        zIndex: 2
      }}
    />
  )
}

export default StaticAnnotationLayer
