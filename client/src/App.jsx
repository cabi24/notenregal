import { useState, useEffect } from 'react'
import { useAuth } from './context/AuthContext'
import Login from './components/Login'
import Sidebar from './components/Sidebar'
import Bookshelf from './components/Bookshelf'
import PdfViewer from './components/PdfViewer'
import RegalpaketViewer from './components/RegalpaketViewer'
import UploadButton from './components/UploadButton'

function App() {
  const { isAuthenticated, isLoading, authFetch } = useAuth()
  const [files, setFiles] = useState([])
  const [shelves, setShelves] = useState([])
  const [activeShelf, setActiveShelf] = useState(null) // null = "All Music"
  const [viewingPdf, setViewingPdf] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [annotatedFiles, setAnnotatedFiles] = useState([])
  const [favorites, setFavorites] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState('name') // 'name', 'date', 'type'
  const [viewMode, setViewMode] = useState('grid') // 'grid' or 'list'

  useEffect(() => {
    if (isAuthenticated) {
      fetchFiles()
      fetchShelves()
      fetchAnnotatedFiles()
      fetchFavorites()
    }
  }, [isAuthenticated])

  const fetchAnnotatedFiles = async () => {
    try {
      const res = await authFetch('/api/annotations')
      const data = await res.json()
      setAnnotatedFiles(data)
    } catch (err) {
      console.error('Failed to fetch annotated files:', err)
    }
  }

  const fetchFavorites = async () => {
    try {
      const res = await authFetch('/api/favorites')
      const data = await res.json()
      setFavorites(data)
    } catch (err) {
      console.error('Failed to fetch favorites:', err)
    }
  }

  const toggleFavorite = async (fileName) => {
    try {
      if (favorites.includes(fileName)) {
        await authFetch(`/api/favorites/${encodeURIComponent(fileName)}`, { method: 'DELETE' })
        setFavorites(favorites.filter(f => f !== fileName))
      } else {
        await authFetch('/api/favorites', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileName })
        })
        setFavorites([...favorites, fileName])
      }
    } catch (err) {
      console.error('Failed to toggle favorite:', err)
    }
  }

  const fetchFiles = async () => {
    const res = await authFetch('/api/files')
    const data = await res.json()
    setFiles(data)
  }

  const fetchShelves = async () => {
    const res = await authFetch('/api/shelves')
    const data = await res.json()
    setShelves(data)
  }

  const createShelf = async (name) => {
    const res = await authFetch('/api/shelves', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    })
    const newShelf = await res.json()
    setShelves([...shelves, newShelf])
  }

  const renameShelf = async (id, name) => {
    await authFetch(`/api/shelves/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    })
    setShelves(shelves.map(s => s.id === id ? { ...s, name } : s))
  }

  const deleteShelf = async (id) => {
    await authFetch(`/api/shelves/${id}`, { method: 'DELETE' })
    setShelves(shelves.filter(s => s.id !== id))
    if (activeShelf === id) setActiveShelf(null)
  }

  const addToShelf = async (shelfId, fileName) => {
    const res = await authFetch(`/api/shelves/${shelfId}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName })
    })
    const updated = await res.json()
    setShelves(shelves.map(s => s.id === shelfId ? updated : s))
  }

  const removeFromShelf = async (shelfId, fileName) => {
    const res = await authFetch(`/api/shelves/${shelfId}/files/${encodeURIComponent(fileName)}`, {
      method: 'DELETE'
    })
    const updated = await res.json()
    setShelves(shelves.map(s => s.id === shelfId ? updated : s))
  }

  const uploadFile = async (file) => {
    setUploading(true)
    const formData = new FormData()
    formData.append('pdf', file)
    try {
      const res = await authFetch('/api/upload', {
        method: 'POST',
        body: formData
      })
      if (res.ok) {
        await fetchFiles()
      }
    } finally {
      setUploading(false)
    }
  }

  const renameFile = async (oldName, newName) => {
    try {
      const res = await authFetch(`/api/files/${encodeURIComponent(oldName)}/rename`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newName })
      })
      if (res.ok) {
        await fetchFiles()
        await fetchShelves()
        return { success: true }
      } else {
        const data = await res.json()
        return { success: false, error: data.error }
      }
    } catch (err) {
      return { success: false, error: err.message }
    }
  }

  const getDisplayedFiles = () => {
    let filtered = files

    // Apply shelf filter
    if (activeShelf === 'favorites') {
      filtered = filtered.filter(f => favorites.includes(f.name))
    } else if (activeShelf === 'regalpakets') {
      filtered = filtered.filter(f => f.type === 'regal')
    } else if (activeShelf) {
      const shelf = shelves.find(s => s.id === activeShelf)
      if (shelf) {
        filtered = filtered.filter(f => shelf.files.includes(f.name))
      }
    }

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim()
      filtered = filtered.filter(f =>
        f.name.toLowerCase().includes(query)
      )
    }

    // Apply sorting
    filtered = [...filtered].sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return a.name.localeCompare(b.name)
        case 'date':
          return (b.mtime || 0) - (a.mtime || 0) // Newest first
        case 'type':
          // Regalpakets first, then PDFs, alphabetically within each group
          if (a.type !== b.type) {
            return a.type === 'regal' ? -1 : 1
          }
          return a.name.localeCompare(b.name)
        default:
          return 0
      }
    })

    return filtered
  }

  // Show loading spinner while checking auth
  if (isLoading) {
    return (
      <div className="app-loading">
        <div className="app-loading-spinner"></div>
      </div>
    )
  }

  // Show login page if not authenticated
  if (!isAuthenticated) {
    return <Login />
  }

  return (
    <div className="app">
      <Sidebar
        shelves={shelves}
        activeShelf={activeShelf}
        onSelectShelf={setActiveShelf}
        onCreateShelf={createShelf}
        onRenameShelf={renameShelf}
        onDeleteShelf={deleteShelf}
      />
      <main className="main-content">
        <div className="main-toolbar">
          <div className="search-bar">
            <input
              type="text"
              placeholder="Search music..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-input"
            />
            {searchQuery && (
              <button className="search-clear" onClick={() => setSearchQuery('')}>×</button>
            )}
          </div>
          <div className="view-toggle">
            <button
              className={`view-toggle-btn ${viewMode === 'grid' ? 'active' : ''}`}
              onClick={() => setViewMode('grid')}
              title="Grid view"
            >
              ▦
            </button>
            <button
              className={`view-toggle-btn ${viewMode === 'list' ? 'active' : ''}`}
              onClick={() => setViewMode('list')}
              title="List view"
            >
              ☰
            </button>
          </div>
          <div className="sort-select-wrapper">
            <select
              className="sort-select"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
            >
              <option value="name">Sort by Name</option>
              <option value="date">Sort by Date</option>
              <option value="type">Sort by Type</option>
            </select>
          </div>
          <UploadButton onUpload={uploadFile} uploading={uploading} />
        </div>
        <Bookshelf
          files={getDisplayedFiles()}
          shelves={shelves}
          activeShelf={activeShelf}
          onOpenPdf={setViewingPdf}
          onAddToShelf={addToShelf}
          onRemoveFromShelf={removeFromShelf}
          onRenameFile={renameFile}
          annotatedFiles={annotatedFiles}
          favorites={favorites}
          onToggleFavorite={toggleFavorite}
          viewMode={viewMode}
        />
      </main>
      {viewingPdf && (
        viewingPdf.type === 'regal' ? (
          <RegalpaketViewer
            file={viewingPdf}
            onClose={() => setViewingPdf(null)}
            onAnnotationsChange={fetchAnnotatedFiles}
          />
        ) : (
          <PdfViewer
            file={viewingPdf}
            onClose={() => setViewingPdf(null)}
            onAnnotationsChange={fetchAnnotatedFiles}
            onConvertToRegal={async () => {
              try {
                const res = await authFetch(`/api/regalpaket/convert/${encodeURIComponent(viewingPdf.name)}`, {
                  method: 'POST'
                })
                if (res.ok) {
                  const data = await res.json()
                  await fetchFiles()
                  await fetchAnnotatedFiles()
                  // Open the new regal file (server returns 'name' not 'regalFileName')
                  setViewingPdf({
                    name: data.name,
                    path: `/api/regalpaket/${encodeURIComponent(data.name)}/page/1`,
                    type: 'regal'
                  })
                } else {
                  const errorData = await res.json()
                  console.error('Failed to convert to Regalpaket:', errorData.error)
                }
              } catch (err) {
                console.error('Failed to convert to Regalpaket:', err)
              }
            }}
          />
        )
      )}
    </div>
  )
}

export default App
