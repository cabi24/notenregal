import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import { useAuth } from '../context/AuthContext'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'

// Set up PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`

function PdfViewer({ file, onClose, onConvertToRegal }) {
  const { token } = useAuth()
  const [numPages, setNumPages] = useState(null)
  const [scale, setScale] = useState(null) // null = fit mode
  const [pageSize, setPageSize] = useState(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [converting, setConverting] = useState(false)
  const containerRef = useRef(null)
  const scrollRef = useRef(null)

  // Touch handling
  const touchStartRef = useRef(null)
  const touchStartTimeRef = useRef(null)

  const calculateFitScale = useCallback(() => {
    if (!scrollRef.current || !pageSize) return 1
    const container = scrollRef.current
    const padding = 60
    const availableWidth = container.clientWidth - padding
    const availableHeight = container.clientHeight - padding

    const scaleX = availableWidth / pageSize.width
    const scaleY = availableHeight / pageSize.height

    return Math.min(scaleX, scaleY, 2)
  }, [pageSize])

  const getEffectiveScale = useCallback(() => {
    if (scale === null) {
      return calculateFitScale()
    }
    return scale
  }, [scale, calculateFitScale])

  const onDocumentLoadSuccess = useCallback(({ numPages }) => {
    setNumPages(numPages)
  }, [])

  const onPageLoadSuccess = useCallback((page) => {
    setPageSize({ width: page.originalWidth, height: page.originalHeight })
  }, [])

  const zoomIn = () => setScale(s => Math.min((s ?? getEffectiveScale()) + 0.25, 3))
  const zoomOut = () => setScale(s => Math.max((s ?? getEffectiveScale()) - 0.25, 0.5))
  const fitToPage = () => setScale(null)

  const prevPage = useCallback(() => {
    setCurrentPage(p => Math.max(p - 1, 1))
  }, [])

  const nextPage = useCallback(() => {
    setCurrentPage(p => Math.min(p + 1, numPages || 1))
  }, [numPages])

  const toggleFullscreen = async () => {
    if (!document.fullscreenElement) {
      await containerRef.current?.requestFullscreen()
    } else {
      await document.exitFullscreen()
    }
  }

  // Touch handlers for swipe navigation
  const handleTouchStart = useCallback((e) => {
    if (e.touches.length === 1) {
      touchStartRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY
      }
      touchStartTimeRef.current = Date.now()
    }
  }, [])

  const handleTouchEnd = useCallback((e) => {
    if (!touchStartRef.current) return

    const touchEnd = e.changedTouches[0]
    const deltaX = touchEnd.clientX - touchStartRef.current.x
    const deltaY = touchEnd.clientY - touchStartRef.current.y
    const deltaTime = Date.now() - touchStartTimeRef.current

    const minSwipeDistance = 50
    const maxSwipeTime = 300

    if (Math.abs(deltaX) > Math.abs(deltaY) &&
        Math.abs(deltaX) > minSwipeDistance &&
        deltaTime < maxSwipeTime) {
      if (deltaX > 0) {
        prevPage()
      } else {
        nextPage()
      }
    }

    touchStartRef.current = null
    touchStartTimeRef.current = null
  }, [prevPage, nextPage])

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        prevPage()
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') {
        e.preventDefault()
        nextPage()
      } else if (e.key === 'Escape' && !document.fullscreenElement) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [prevPage, nextPage, onClose])

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement)
      setScale(null)
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  // Recalculate fit on window resize
  useEffect(() => {
    const handleResize = () => {
      if (scale === null) {
        setPageSize(ps => ps ? { ...ps } : null)
      }
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [scale])

  const handleConvertToRegal = async () => {
    if (converting) return
    setConverting(true)
    try {
      await onConvertToRegal?.()
    } finally {
      setConverting(false)
    }
  }

  const effectiveScale = getEffectiveScale()
  const isFitMode = scale === null

  // Calculate pages to preload (current, previous, next)
  const pagesToRender = []
  if (currentPage > 1) pagesToRender.push(currentPage - 1)
  pagesToRender.push(currentPage)
  if (numPages && currentPage < numPages) pagesToRender.push(currentPage + 1)

  return (
    <div className="pdf-overlay" onClick={onClose}>
      <div
        ref={containerRef}
        className={`pdf-container ${isFullscreen ? 'pdf-fullscreen' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pdf-header">
          <h2 className="pdf-title">{file.name.replace(/\.pdf$/i, '')}</h2>
          <div className="pdf-controls">
            <button className="pdf-control-btn" onClick={zoomOut} title="Zoom out">-</button>
            <button
              className={`pdf-zoom-level ${isFitMode ? 'pdf-fit-active' : ''}`}
              onClick={fitToPage}
              title="Fit to page"
            >
              {isFitMode ? 'Fit' : `${Math.round(effectiveScale * 100)}%`}
            </button>
            <button className="pdf-control-btn" onClick={zoomIn} title="Zoom in">+</button>
            <span className="pdf-divider">|</span>
            <button className="pdf-control-btn" onClick={prevPage} disabled={currentPage <= 1}>&#8249;</button>
            <span className="pdf-page-info">{currentPage} / {numPages || '?'}</span>
            <button className="pdf-control-btn" onClick={nextPage} disabled={currentPage >= numPages}>&#8250;</button>
            <span className="pdf-divider">|</span>
            <button className="pdf-control-btn" onClick={toggleFullscreen} title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
              {isFullscreen ? '⤓' : '⤢'}
            </button>
            <span className="pdf-divider">|</span>
            <button
              className="pdf-control-btn regal-convert-btn"
              onClick={handleConvertToRegal}
              disabled={converting}
              title="Convert to Regalpaket for annotations and faster page turns"
            >
              {converting ? 'Converting...' : 'Make Regalpaket'}
            </button>
          </div>
          <button className="pdf-close" onClick={onClose}>×</button>
        </div>

        <div
          className="pdf-scroll-container"
          ref={scrollRef}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          <Document
            file={`${file.path}?token=${encodeURIComponent(token)}`}
            onLoadSuccess={onDocumentLoadSuccess}
            loading={<div className="pdf-loading">Loading...</div>}
            error={<div className="pdf-error">Failed to load PDF</div>}
          >
            {/* Preload adjacent pages (hidden) */}
            {pagesToRender.map(pageNum => (
              <div
                key={pageNum}
                className="pdf-page-wrapper"
                style={{
                  display: pageNum === currentPage ? 'block' : 'none',
                  position: pageNum === currentPage ? 'relative' : 'absolute',
                  visibility: pageNum === currentPage ? 'visible' : 'hidden'
                }}
              >
                <Page
                  pageNumber={pageNum}
                  scale={effectiveScale}
                  onLoadSuccess={pageNum === currentPage ? onPageLoadSuccess : undefined}
                  loading={pageNum === currentPage ? <div className="pdf-loading">Loading page...</div> : null}
                  renderTextLayer={pageNum === currentPage}
                  renderAnnotationLayer={pageNum === currentPage}
                />
              </div>
            ))}
          </Document>
        </div>
      </div>
    </div>
  )
}

export default PdfViewer
