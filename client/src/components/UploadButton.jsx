import { useRef } from 'react'

function UploadButton({ onUpload, uploading }) {
  const inputRef = useRef(null)

  const handleClick = () => {
    inputRef.current?.click()
  }

  const handleChange = (e) => {
    const file = e.target.files?.[0]
    if (file) {
      onUpload(file)
      e.target.value = ''
    }
  }

  return (
    <div className="upload-container">
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,application/pdf"
        onChange={handleChange}
        style={{ display: 'none' }}
      />
      <button
        className="upload-btn"
        onClick={handleClick}
        disabled={uploading}
      >
        {uploading ? 'Uploading...' : '+ Upload PDF'}
      </button>
    </div>
  )
}

export default UploadButton
