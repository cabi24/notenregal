import { useState } from 'react'

function Bookshelf({ files, shelves, activeShelf, onOpenPdf, onAddToShelf, onRemoveFromShelf, onRenameFile, annotatedFiles = [], favorites = [], onToggleFavorite, viewMode = 'grid' }) {
  const [contextMenu, setContextMenu] = useState(null)
  const [renameModal, setRenameModal] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [renameError, setRenameError] = useState('')

  const handleContextMenu = (e, file) => {
    e.preventDefault()
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      file
    })
  }

  const closeContextMenu = () => setContextMenu(null)

  const handleAddToShelf = (shelfId) => {
    onAddToShelf(shelfId, contextMenu.file.name)
    closeContextMenu()
  }

  const handleRemoveFromShelf = () => {
    if (activeShelf) {
      onRemoveFromShelf(activeShelf, contextMenu.file.name)
    }
    closeContextMenu()
  }

  const getDisplayName = (filename) => {
    return filename.replace(/\.(pdf|regal)$/i, '')
  }

  const handleRenameClick = () => {
    const displayName = getDisplayName(contextMenu.file.name)
    setRenameValue(displayName)
    setRenameError('')
    setRenameModal(contextMenu.file)
    closeContextMenu()
  }

  const handleRenameSubmit = async (e) => {
    e.preventDefault()
    if (!renameValue.trim()) {
      setRenameError('Name cannot be empty')
      return
    }
    const result = await onRenameFile(renameModal.name, renameValue.trim())
    if (result.success) {
      setRenameModal(null)
      setRenameValue('')
      setRenameError('')
    } else {
      setRenameError(result.error || 'Failed to rename')
    }
  }

  const closeRenameModal = () => {
    setRenameModal(null)
    setRenameValue('')
    setRenameError('')
  }

  return (
    <div className={`bookshelf ${viewMode === 'list' ? 'bookshelf-list-view' : ''}`} onClick={closeContextMenu}>
      {viewMode === 'list' ? (
        <div className="list-container">
          {files.length === 0 ? (
            <div className="empty-shelf">
              <p>No sheet music here yet.</p>
              <p className="empty-hint">Add PDF files to the library folder.</p>
            </div>
          ) : (
            files.map(file => {
              const hasAnnotations = annotatedFiles.includes(file.name)
              const isRegalpaket = file.type === 'regal'
              const isFavorite = favorites.includes(file.name)
              return (
                <div
                  key={file.name}
                  className={`list-item ${isRegalpaket ? 'list-item-regalpaket' : ''}`}
                  onClick={() => onOpenPdf(file)}
                  onContextMenu={(e) => handleContextMenu(e, file)}
                >
                  <div className="list-item-icon">🎼</div>
                  <span className="list-item-title">{getDisplayName(file.name)}</span>
                  <div className="list-item-badges">
                    {isFavorite && <span className="list-badge list-badge-favorite" title="Favorite">★</span>}
                    {isRegalpaket && <span className="list-badge list-badge-regal" title="Regalpaket">R</span>}
                    {hasAnnotations && <span className="list-badge list-badge-annotation" title="Has annotations">✏</span>}
                  </div>
                </div>
              )
            })
          )}
        </div>
      ) : (
        <div className="shelf-row">
          <div className="books-container">
            {files.length === 0 ? (
              <div className="empty-shelf">
                <p>No sheet music here yet.</p>
                <p className="empty-hint">Add PDF files to the library folder.</p>
              </div>
            ) : (
              files.map(file => {
                const hasAnnotations = annotatedFiles.includes(file.name)
                const isRegalpaket = file.type === 'regal'
                return (
                  <div
                    key={file.name}
                    className={`book ${isRegalpaket ? 'book-regalpaket' : ''}`}
                    onClick={() => onOpenPdf(file)}
                    onContextMenu={(e) => handleContextMenu(e, file)}
                  >
                    <div className="book-cover">
                      <div className="book-spine"></div>
                      <div className="book-icon">🎼</div>
                      {isRegalpaket && (
                        <div className="book-regal-badge" title="Regalpaket - optimized for fast page turns">
                          <span className="regal-badge-icon">R</span>
                        </div>
                      )}
                      {hasAnnotations && (
                        <div className="book-annotation-badge" title="Has annotations">
                          <span className="annotation-badge-icon">✏</span>
                        </div>
                      )}
                      {favorites.includes(file.name) && (
                        <div className="book-favorite-badge" title="Favorite">
                          <span className="favorite-badge-icon">★</span>
                        </div>
                      )}
                    </div>
                    <span className="book-title">{getDisplayName(file.name)}</span>
                  </div>
                )
              })
            )}
          </div>
          <div className="shelf-wood"></div>
        </div>
      )}

      {contextMenu && (
        <div
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="context-menu-item"
            onClick={handleRenameClick}
          >
            Rename
          </button>
          <button
            className="context-menu-item context-menu-favorite"
            onClick={() => {
              onToggleFavorite(contextMenu.file.name)
              closeContextMenu()
            }}
          >
            {favorites.includes(contextMenu.file.name) ? '★ Remove from Favorites' : '☆ Add to Favorites'}
          </button>
          <div className="context-menu-divider"></div>
          <div className="context-menu-header">Add to shelf:</div>
          {shelves.map(shelf => (
            <button
              key={shelf.id}
              className="context-menu-item"
              onClick={() => handleAddToShelf(shelf.id)}
            >
              {shelf.name}
              {shelf.files.includes(contextMenu.file.name) && ' ✓'}
            </button>
          ))}
          {activeShelf && (
            <>
              <div className="context-menu-divider"></div>
              <button
                className="context-menu-item context-menu-remove"
                onClick={handleRemoveFromShelf}
              >
                Remove from this shelf
              </button>
            </>
          )}
        </div>
      )}

      {renameModal && (
        <div className="rename-modal-overlay" onClick={closeRenameModal}>
          <div className="rename-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Rename</h3>
            <form onSubmit={handleRenameSubmit}>
              <input
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                autoFocus
                className="rename-input"
                placeholder="Enter new name"
              />
              {renameError && <div className="rename-error">{renameError}</div>}
              <div className="rename-buttons">
                <button type="button" className="rename-cancel" onClick={closeRenameModal}>
                  Cancel
                </button>
                <button type="submit" className="rename-submit">
                  Rename
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default Bookshelf
