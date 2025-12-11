import { useState, useCallback, useRef, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import AnnotationCanvas from './AnnotationCanvas'
import AnnotationToolbar from './AnnotationToolbar'
import StaticAnnotationLayer from './StaticAnnotationLayer'

function RegalpaketViewer({ file, onClose, onAnnotationsChange }) {
  const { authFetch, token } = useAuth()
  const [manifest, setManifest] = useState(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [scale, setScale] = useState(null) // null = fit mode
  const [imageSize, setImageSize] = useState(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [twoPageSpread, setTwoPageSpread] = useState(false)

  // Page turn animation state
  const [isAnimating, setIsAnimating] = useState(false)
  const [animationDirection, setAnimationDirection] = useState(null) // 'next' or 'prev'
  const [displayPage, setDisplayPage] = useState(1) // The page currently shown during animation

  // Preloaded images
  const imageCache = useRef({})
  const [currentImageLoaded, setCurrentImageLoaded] = useState(false)

  const containerRef = useRef(null)
  const scrollRef = useRef(null)
  const imageRef = useRef(null)

  // Annotation state
  const [annotationMode, setAnnotationMode] = useState(false)
  const [annotationTool, setAnnotationTool] = useState('pen')
  const [annotationColor, setAnnotationColor] = useState('#1a1a1a')
  const [annotationLineWidth, setAnnotationLineWidth] = useState(4)
  const [annotationStamp, setAnnotationStamp] = useState('fermata')
  const [annotations, setAnnotations] = useState({})
  const [showAnnotations, setShowAnnotations] = useState(true)
  const canvasRef = useRef(null)

  // Touch handling
  const touchStartRef = useRef(null)
  const touchStartTimeRef = useRef(null)

  // Load manifest on mount
  useEffect(() => {
    const loadManifest = async () => {
      try {
        setLoading(true)
        const res = await authFetch(`/api/regalpaket/${encodeURIComponent(file.name)}/manifest`)
        if (!res.ok) throw new Error('Failed to load manifest')
        const data = await res.json()
        setManifest(data)

        // Load all annotations
        const annotRes = await authFetch(`/api/regalpaket/${encodeURIComponent(file.name)}/annotations`)
        const annotData = await annotRes.json()
        setAnnotations(annotData)

        setLoading(false)
      } catch (err) {
        setError(err.message)
        setLoading(false)
      }
    }
    loadManifest()
  }, [file.name, authFetch])

  // Preload images
  useEffect(() => {
    if (!manifest || !token) return

    const preloadImage = (pageNum) => {
      if (imageCache.current[pageNum]) return

      const img = new Image()
      // Add auth token to image URL
      img.src = `/api/regalpaket/${encodeURIComponent(file.name)}/page/${pageNum}?token=${encodeURIComponent(token)}`
      img.onload = () => {
        imageCache.current[pageNum] = img
        // If this is the current page, trigger update
        if (pageNum === currentPage) {
          setImageSize({ width: img.naturalWidth, height: img.naturalHeight })
          setCurrentImageLoaded(true)
        }
      }
    }

    // Preload current, previous, and next pages
    preloadImage(currentPage)
    if (currentPage > 1) preloadImage(currentPage - 1)
    if (currentPage < manifest.pageCount) preloadImage(currentPage + 1)

    // Preload all pages in background
    for (let i = 1; i <= manifest.pageCount; i++) {
      setTimeout(() => preloadImage(i), i * 100)
    }
  }, [manifest, currentPage, file.name, token])

  // Update image size when current page changes
  useEffect(() => {
    const cached = imageCache.current[currentPage]
    if (cached) {
      setImageSize({ width: cached.naturalWidth, height: cached.naturalHeight })
      setCurrentImageLoaded(true)
    } else {
      setCurrentImageLoaded(false)
    }
    // Keep displayPage in sync when not animating
    if (!isAnimating) {
      setDisplayPage(currentPage)
    }
  }, [currentPage, isAnimating])

  const calculateFitScale = useCallback(() => {
    if (!scrollRef.current || !imageSize) return 1
    const container = scrollRef.current
    const padding = 60
    const availableWidth = container.clientWidth - padding
    const availableHeight = container.clientHeight - padding

    // In two-page mode, each page gets half the width (minus gap)
    const effectiveWidth = twoPageSpread ? (availableWidth - 20) / 2 : availableWidth
    const scaleX = effectiveWidth / imageSize.width
    const scaleY = availableHeight / imageSize.height

    return Math.min(scaleX, scaleY, 1) // Cap at 100% for images (they're already high res)
  }, [imageSize, twoPageSpread])

  const getEffectiveScale = useCallback(() => {
    if (scale === null) {
      return calculateFitScale()
    }
    return scale
  }, [scale, calculateFitScale])

  // Save annotations
  const saveAnnotations = useCallback(async (pageNumber, strokes) => {
    try {
      await authFetch(`/api/regalpaket/${encodeURIComponent(file.name)}/annotations/${pageNumber}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strokes })
      })
      onAnnotationsChange?.()
    } catch (err) {
      console.error('Failed to save annotations:', err)
    }
  }, [file.name, onAnnotationsChange, authFetch])

  const handleStrokesChange = useCallback((strokes) => {
    setAnnotations(prev => ({
      ...prev,
      [currentPage]: strokes
    }))
    saveAnnotations(currentPage, strokes)
  }, [currentPage, saveAnnotations])

  const handleUndo = useCallback(() => {
    canvasRef.current?.undo()
  }, [])

  const zoomIn = () => setScale(s => Math.min((s ?? getEffectiveScale()) + 0.1, 2))
  const zoomOut = () => setScale(s => Math.max((s ?? getEffectiveScale()) - 0.1, 0.2))
  const fitToPage = () => setScale(null)

  const prevPage = useCallback(() => {
    if (isAnimating || currentPage <= 1) return
    const step = twoPageSpread ? 2 : 1
    const newPage = Math.max(1, currentPage - step)

    // For prev: show current page underneath, new page flips in from left
    setDisplayPage(currentPage) // Current stays underneath initially
    setAnimationDirection('prev')
    setIsAnimating(true)

    // After animation completes, update to new page
    setTimeout(() => {
      setCurrentPage(newPage)
      setDisplayPage(newPage)
      setIsAnimating(false)
      setAnimationDirection(null)
    }, 500)
  }, [currentPage, isAnimating, twoPageSpread])

  const nextPage = useCallback(() => {
    if (!manifest || isAnimating || currentPage >= manifest.pageCount) return
    const step = twoPageSpread ? 2 : 1
    const newPage = Math.min(manifest.pageCount, currentPage + step)

    // For next: show new page underneath, current page flips away
    setDisplayPage(newPage) // New page shows underneath immediately
    setAnimationDirection('next')
    setIsAnimating(true)

    // After animation completes, finalize the page change
    setTimeout(() => {
      setCurrentPage(newPage)
      setIsAnimating(false)
      setAnimationDirection(null)
    }, 500)
  }, [manifest, currentPage, isAnimating, twoPageSpread])

  const toggleFullscreen = async () => {
    if (!document.fullscreenElement) {
      await containerRef.current?.requestFullscreen()
    } else {
      await document.exitFullscreen()
    }
  }

  // Touch handlers
  const handleTouchStart = useCallback((e) => {
    if (annotationMode) return
    if (e.touches.length === 1) {
      touchStartRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY
      }
      touchStartTimeRef.current = Date.now()
    }
  }, [annotationMode])

  const handleTouchEnd = useCallback((e) => {
    if (annotationMode) return
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
  }, [annotationMode, prevPage, nextPage])

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

  // Recalculate fit on resize
  useEffect(() => {
    const handleResize = () => {
      if (scale === null) {
        setImageSize(s => s ? { ...s } : null)
      }
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [scale])

  const effectiveScale = getEffectiveScale()
  const isFitMode = scale === null

  const renderedWidth = imageSize ? Math.round(imageSize.width * effectiveScale) : 0
  const renderedHeight = imageSize ? Math.round(imageSize.height * effectiveScale) : 0

  const currentPageStrokes = annotations[currentPage] || []
  const hasStrokes = currentPageStrokes.length > 0

  const pageCount = manifest?.pageCount || 0

  // Calculate the second page for two-page spread (right side)
  const secondPage = twoPageSpread && currentPage < pageCount ? currentPage + 1 : null
  const secondPageStrokes = secondPage ? (annotations[secondPage] || []) : []

  if (loading) {
    return (
      <div className="pdf-overlay">
        <div className="pdf-container">
          <div className="pdf-loading">Loading Regalpaket...</div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="pdf-overlay" onClick={onClose}>
        <div className="pdf-container" onClick={e => e.stopPropagation()}>
          <div className="pdf-error">{error}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="pdf-overlay" onClick={onClose}>
      <div
        ref={containerRef}
        className={`pdf-container ${isFullscreen ? 'pdf-fullscreen' : ''} ${annotationMode ? 'annotation-active' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pdf-header">
          <h2 className="pdf-title">
            <span className="regal-badge">R</span>
            {manifest?.name || file.name.replace(/\.regal$/i, '')}
          </h2>
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
            <span className="pdf-page-info">
              {twoPageSpread && secondPage ? `${currentPage}-${secondPage}` : currentPage} / {pageCount}
            </span>
            <button className="pdf-control-btn" onClick={nextPage} disabled={twoPageSpread ? currentPage >= pageCount - 1 : currentPage >= pageCount}>&#8250;</button>
            <span className="pdf-divider">|</span>
            <button
              className={`pdf-control-btn ${annotationMode ? 'pdf-control-active' : ''}`}
              onClick={() => setAnnotationMode(m => !m)}
              title={annotationMode ? 'Exit annotation mode' : 'Annotate'}
            >
              ✏
            </button>
            <button
              className={`pdf-control-btn ${showAnnotations ? 'pdf-control-active' : ''}`}
              onClick={() => setShowAnnotations(s => !s)}
              title={showAnnotations ? 'Hide annotations' : 'Show annotations'}
            >
              {showAnnotations ? '👁' : '👁‍🗨'}
            </button>
            <button
              className={`pdf-control-btn ${twoPageSpread ? 'pdf-control-active' : ''}`}
              onClick={() => { setTwoPageSpread(s => !s); setScale(null); }}
              title={twoPageSpread ? 'Single page view' : 'Two-page spread'}
            >
              {twoPageSpread ? '📖' : '📄'}
            </button>
            <button className="pdf-control-btn" onClick={toggleFullscreen} title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
              {isFullscreen ? '⤓' : '⤢'}
            </button>
          </div>
          <button className="pdf-close" onClick={onClose}>×</button>
        </div>

        <AnnotationToolbar
          enabled={annotationMode}
          onToggle={() => setAnnotationMode(m => !m)}
          tool={annotationTool}
          onToolChange={setAnnotationTool}
          color={annotationColor}
          onColorChange={setAnnotationColor}
          lineWidth={annotationLineWidth}
          onLineWidthChange={setAnnotationLineWidth}
          stamp={annotationStamp}
          onStampChange={setAnnotationStamp}
          onUndo={handleUndo}
          canUndo={hasStrokes}
        />

        <div
          className="pdf-scroll-container regal-scroll-container"
          ref={scrollRef}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          <div className={`regal-book-wrapper ${twoPageSpread ? 'two-page-spread' : ''}`} style={{ perspective: '2000px' }}>
            {/* Two-page spread layout */}
            {twoPageSpread ? (
              <div className="two-page-container" style={{ display: 'flex', gap: '20px' }}>
                {/* Left page (current) */}
                <div className="regal-page-container" style={{ width: renderedWidth || 400, height: renderedHeight || 600 }}>
                  <div className="regal-page regal-page-underneath">
                    {imageCache.current[currentPage] ? (
                      <img
                        src={imageCache.current[currentPage].src}
                        alt={`Page ${currentPage}`}
                        style={{ width: renderedWidth, height: renderedHeight, display: 'block' }}
                        className="regal-page-image"
                      />
                    ) : (
                      <div className="pdf-loading regal-page-loading" style={{ width: renderedWidth || 400, height: renderedHeight || 600 }}>
                        Loading page...
                      </div>
                    )}
                    {showAnnotations && renderedWidth > 0 && renderedHeight > 0 && (
                      <StaticAnnotationLayer width={renderedWidth} height={renderedHeight} strokes={currentPageStrokes} />
                    )}
                  </div>
                </div>
                {/* Right page (second) */}
                {secondPage && (
                  <div className="regal-page-container" style={{ width: renderedWidth || 400, height: renderedHeight || 600 }}>
                    <div className="regal-page regal-page-underneath">
                      {imageCache.current[secondPage] ? (
                        <img
                          src={imageCache.current[secondPage].src}
                          alt={`Page ${secondPage}`}
                          style={{ width: renderedWidth, height: renderedHeight, display: 'block' }}
                          className="regal-page-image"
                        />
                      ) : (
                        <div className="pdf-loading regal-page-loading" style={{ width: renderedWidth || 400, height: renderedHeight || 600 }}>
                          Loading page...
                        </div>
                      )}
                      {showAnnotations && renderedWidth > 0 && renderedHeight > 0 && (
                        <StaticAnnotationLayer width={renderedWidth} height={renderedHeight} strokes={secondPageStrokes} />
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* Single page with animation */
              <div
                className={`regal-page-container ${isAnimating ? `regal-animating regal-turn-${animationDirection}` : ''}`}
                style={{
                  width: renderedWidth || 400,
                  height: renderedHeight || 600
                }}
              >
                {/* Destination page (shown underneath during animation) */}
                <div className="regal-page regal-page-underneath">
                  {imageCache.current[displayPage] ? (
                    <img
                      src={imageCache.current[displayPage].src}
                      alt={`Page ${displayPage}`}
                      style={{
                        width: renderedWidth,
                        height: renderedHeight,
                        display: 'block'
                      }}
                      className="regal-page-image"
                    />
                  ) : (
                    <div
                      className="pdf-loading regal-page-loading"
                      style={{ width: renderedWidth || 400, height: renderedHeight || 600 }}
                    >
                      Loading page...
                    </div>
                  )}
                  {/* Static annotations for the underneath page during animation */}
                  {isAnimating && showAnnotations && renderedWidth > 0 && renderedHeight > 0 && (
                    <StaticAnnotationLayer
                      width={renderedWidth}
                      height={renderedHeight}
                      strokes={annotations[displayPage] || []}
                    />
                  )}
                </div>

                {/* Flipping page overlay (the old page flipping away) */}
                {isAnimating && animationDirection === 'next' && imageCache.current[currentPage] && (
                  <div className="regal-page regal-page-flip regal-flip-next">
                    <img
                      src={imageCache.current[currentPage].src}
                      alt={`Page ${currentPage} turning`}
                      style={{
                        width: renderedWidth,
                        height: renderedHeight,
                        display: 'block'
                      }}
                      className="regal-page-image"
                    />
                    {/* Static annotations on the flipping page */}
                    {showAnnotations && (
                      <StaticAnnotationLayer
                        width={renderedWidth}
                        height={renderedHeight}
                        strokes={annotations[currentPage] || []}
                      />
                    )}
                    <div className="regal-page-shadow"></div>
                  </div>
                )}

                {isAnimating && animationDirection === 'prev' && imageCache.current[currentPage - 1] && (
                  <div className="regal-page regal-page-flip regal-flip-prev">
                    <img
                      src={imageCache.current[currentPage - 1].src}
                      alt={`Page ${currentPage - 1} turning back`}
                      style={{
                        width: renderedWidth,
                        height: renderedHeight,
                        display: 'block'
                      }}
                      className="regal-page-image"
                    />
                    {/* Static annotations on the flipping page */}
                    {showAnnotations && (
                      <StaticAnnotationLayer
                        width={renderedWidth}
                        height={renderedHeight}
                        strokes={annotations[currentPage - 1] || []}
                      />
                    )}
                    <div className="regal-page-shadow regal-page-shadow-prev"></div>
                  </div>
                )}

                {/* Interactive annotation canvas (only when not animating) */}
                {!isAnimating && showAnnotations && renderedWidth > 0 && renderedHeight > 0 && (
                  <AnnotationCanvas
                    key={`${file.name}-${currentPage}`}
                    ref={canvasRef}
                    width={renderedWidth}
                    height={renderedHeight}
                    tool={annotationTool}
                    color={annotationColor}
                    lineWidth={annotationLineWidth}
                    stamp={annotationStamp}
                    enabled={annotationMode}
                    initialStrokes={currentPageStrokes}
                    onStrokesChange={handleStrokesChange}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default RegalpaketViewer
