# Notenregal

A beautiful Victorian-themed sheet music library for organizing, viewing, and annotating your PDF collection.

![License](https://img.shields.io/github/license/cabi24/notenregal)
![Docker Pulls](https://img.shields.io/docker/pulls/cabi24/notenregal)
![Docker Image Size](https://img.shields.io/docker/image-size/cabi24/notenregal/latest)

## Features

- **PDF Viewer** - Smooth page navigation with zoom controls
- **Annotation Tools** - Pen, highlighter, eraser, and musical stamps (fermata, accents, dynamics)
- **Regalpaket Format** - Convert PDFs to pre-rendered images for instant page turns
- **Shelf Organization** - Create custom shelves to categorize your music
- **Favorites** - Mark songs with a star for quick access
- **Search & Sort** - Find music by name, sort by date or type
- **Grid & List Views** - Switch views to see full titles
- **Mobile Friendly** - Touch gestures for page turning
- **Password Protected** - Simple authentication to secure your library

## Quick Start

### Docker Run

```bash
docker run -d \
  --name notenregal \
  --restart unless-stopped \
  -p 3001:3001 \
  -v /path/to/your/music:/library \
  -v notenregal-data:/data \
  cabi24/notenregal
```

Open `http://localhost:3001` and set your password.

### Docker Compose

```yaml
services:
  notenregal:
    image: cabi24/notenregal:latest
    container_name: notenregal
    restart: unless-stopped
    ports:
      - "3001:3001"
    volumes:
      - /path/to/your/music:/library
      - notenregal-data:/data

volumes:
  notenregal-data:
```

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `PORT` | `3001` | Server port |
| `LIBRARY_PATH` | `/library` | Path to sheet music |
| `DATA_PATH` | `/data` | Path to config files |

## Usage

### Adding Music
Drop PDF files into your library directory. They appear automatically on refresh.

### Organizing
- **Shelves** - Create shelves in the sidebar, right-click songs to add them
- **Favorites** - Right-click any song to toggle favorite status
- **Search** - Use the search bar to filter by name

### Annotations
Open any PDF and click the pencil icon to enter annotation mode:
- **Pen** - Freehand drawing
- **Highlighter** - Semi-transparent marking
- **Stamps** - Musical notation (fermata, accents, breath marks)
- **Eraser** - Remove strokes

Annotations are saved automatically.

### Regalpaket
For performance use, convert PDFs to Regalpaket format:
1. Open a PDF
2. Click "Make Regalpaket"
3. Pages are pre-rendered as images for instant display

## Development

```bash
# Clone the repo
git clone https://github.com/cabi24/notenregal.git
cd notenregal

# Install dependencies
npm install
cd client && npm install && cd ..

# Run development servers
npm run dev
```

The client runs on `http://localhost:3000` and proxies API requests to the server on port 3001.

## Building

```bash
# Build the client
npm run build

# Build Docker image
docker build -t notenregal .
```

## Architecture

- **Frontend** - React + Vite
- **Backend** - Node.js + Express
- **PDF Rendering** - react-pdf (PDF.js)
- **Storage** - File-based JSON for simplicity

## Links

- [DockerHub](https://hub.docker.com/r/cabi24/notenregal)
- [GitHub](https://github.com/cabi24/notenregal)

## License

MIT
