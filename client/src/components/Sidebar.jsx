import { useState } from 'react'

function Sidebar({ shelves, activeShelf, onSelectShelf, onCreateShelf, onRenameShelf, onDeleteShelf }) {
  const [editingId, setEditingId] = useState(null)
  const [editName, setEditName] = useState('')

  const handleStartEdit = (shelf) => {
    setEditingId(shelf.id)
    setEditName(shelf.name)
  }

  const handleSaveEdit = (id) => {
    if (editName.trim()) {
      onRenameShelf(id, editName.trim())
    }
    setEditingId(null)
  }

  const handleKeyDown = (e, id) => {
    if (e.key === 'Enter') handleSaveEdit(id)
    if (e.key === 'Escape') setEditingId(null)
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <img src="/logo.png" alt="Notenregal" className="sidebar-logo" />
      </div>

      <nav className="shelf-list">
        <button
          className={`shelf-item ${activeShelf === null ? 'active' : ''}`}
          onClick={() => onSelectShelf(null)}
        >
          <span className="shelf-icon">&#9835;</span>
          All Music
        </button>

        <button
          className={`shelf-item shelf-item-favorites ${activeShelf === 'favorites' ? 'active' : ''}`}
          onClick={() => onSelectShelf('favorites')}
        >
          <span className="shelf-icon">★</span>
          Favorites
        </button>

        <button
          className={`shelf-item shelf-item-regal ${activeShelf === 'regalpakets' ? 'active' : ''}`}
          onClick={() => onSelectShelf('regalpakets')}
        >
          <span className="shelf-icon regal-icon">R</span>
          All Regalpakets
        </button>

        <div className="shelf-divider"></div>
        <h2 className="shelf-heading">Shelves</h2>

        {shelves.map(shelf => (
          <div key={shelf.id} className={`shelf-item ${activeShelf === shelf.id ? 'active' : ''}`}>
            {editingId === shelf.id ? (
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onBlur={() => handleSaveEdit(shelf.id)}
                onKeyDown={(e) => handleKeyDown(e, shelf.id)}
                autoFocus
                className="shelf-edit-input"
              />
            ) : (
              <>
                <button
                  className="shelf-button"
                  onClick={() => onSelectShelf(shelf.id)}
                >
                  <span className="shelf-icon">&#9834;</span>
                  {shelf.name}
                </button>
                <div className="shelf-actions">
                  <button
                    className="shelf-action-btn"
                    onClick={() => handleStartEdit(shelf)}
                    title="Rename"
                  >
                    ✏️
                  </button>
                  <button
                    className="shelf-action-btn"
                    onClick={() => onDeleteShelf(shelf.id)}
                    title="Delete"
                  >
                    🗑️
                  </button>
                </div>
              </>
            )}
          </div>
        ))}

        <button
          className="add-shelf-btn"
          onClick={() => onCreateShelf('New Shelf')}
        >
          + Add Shelf
        </button>
      </nav>
    </aside>
  )
}

export default Sidebar
