const { addonBuilder } = require('stremio-addon-sdk');
const NodeCache = require('node-cache');
const axios = require('axios');

// Initialize addon builder with proper configuration
const builder = new addonBuilder({
    id: 'org.bytetan.bytewatch',
    version: '1.0.2',
    name: 'ByteWatch',
    description: 'Get stream links for tv shows and movies from multiple sources',
    resources: ['stream'],
    types: ['movie', 'series'],
    catalogs: [],
    logo: 'https://www.bytetan.com/static/img/logo.png',
    idPrefixes: ['tt'],
    // Add background property for better Stremio compatibility
    background: 'https://www.bytetan.com/static/img/logo.png'
});

// Setup cache with longer TTL for better performance
const streamCache = new NodeCache({ stdTTL: 14400, checkperiod: 600 }); // 4 hours cache

// Improved logger for Vercel
const logger = {
    info: (msg) => console.log(`[${new Date().toISOString()}] INFO: ${msg}`),
    warn: (msg) => console.warn(`[${new Date().toISOString()}] WARN: ${msg}`),
    error: (msg) => console.error(`[${new Date().toISOString()}] ERROR: ${msg}`)
};

// Fetch OMDB details with better error handling
async function fetchOmdbDetails(imdbId) {
    try {
        const response = await axios.get(`https://www.omdbapi.com/?i=${imdbId}&apikey=b1e4f11`, {
            timeout: 5000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        
        if (response.data.Response === 'False') {
            throw new Error(response.data.Error || 'Failed to fetch data from OMDB API');
        }
        return response.data;
    } catch (e) {
        logger.error(`Error fetching OMDB metadata for ${imdbId}: ${e.message}`);
        return null;
    }
}

// Fetch TMDB ID with improved error handling
async function fetchTmdbId(imdbId) {
    try {
        const response = await axios.get(
            `https://api.themoviedb.org/3/find/${imdbId}?external_source=imdb_id`,
            {
                timeout: 5000,
                headers: {
                    'accept': 'application/json',
                    'Authorization': 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiI3M2EyNzkwNWM1Y2IzNjE1NDUyOWNhN2EyODEyMzc0NCIsIm5iZiI6MS43MjM1ODA5NTAwMDg5OTk4ZSs5LCJzdWIiOiI2NmJiYzIxNjI2NmJhZmVmMTQ4YzVkYzkiLCJzY29wZXMiOlsiYXBpX3JlYWQiXSwidmVyc2lvbiI6MX0.y7N6qt4Lja5M6wnFkqqo44mzEMJ60Pzvm0z_TfA1vxk',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            }
        );
        return response.data;
    } catch (e) {
        logger.error(`Error fetching TMDB data for ${imdbId}: ${e.message}`);
        return null;
    }
}

// Simplified stream extraction for Vercel environment
async function getSimpleStreams({ type, imdbId, season, episode }) {
    const streams = {};
    
    try {
        const tmdbRes = await fetchTmdbId(imdbId);
        
        if (!tmdbRes) {
            logger.warn('Failed to fetch TMDB data');
            return streams;
        }

        const id = type === 'movie'
            ? tmdbRes['movie_results'][0]?.id
            : tmdbRes['tv_results'][0]?.id;

        if (!id) {
            logger.warn('TMDB ID not found');
            return streams;
        }

        // For Vercel, use direct streaming URLs instead of Puppeteer scraping
        // This is a fallback approach - you might want to implement API-based extraction
        const streamSources = [
            {
                name: 'VidSrc',
                url: type === 'movie' 
                    ? `https://vidsrc.xyz/embed/movie/${id}`
                    : `https://vidsrc.xyz/embed/tv/${id}/${season}/${episode}`
            },
            {
                name: 'Embed',
                url: type === 'movie'
                    ? `https://embed.su/embed/movie/${id}`
                    : `https://embed.su/embed/tv/${id}/${season}/${episode}`
            }
        ];

        // Add the streaming sources
        streamSources.forEach(source => {
            streams[source.name] = source.url;
        });

        return streams;
    } catch (error) {
        logger.error(`Error in getSimpleStreams: ${error.message}`);
        return streams;
    }
}

// Get movie streams
async function getMovieStreams(imdbId) {
    const cacheKey = `movie:${imdbId}`;
    
    // Check cache first
    const cached = streamCache.get(cacheKey);
    if (cached) {
        logger.info(`Using cached streams for movie ${imdbId}`);
        return cached;
    }

    try {
        const metadata = await fetchOmdbDetails(imdbId);
        const streams = await getSimpleStreams({ type: 'movie', imdbId });
        
        const streamArray = Object.entries(streams).map(([name, url]) => ({
            name: `🎬 ${name}`,
            url,
            title: `${metadata?.Title || 'Movie'} (${metadata?.Year || 'Unknown'})`,
            description: `Watch ${metadata?.Title || 'this movie'} in HD quality`
        }));

        // Cache the results
        streamCache.set(cacheKey, streamArray);
        return streamArray;
    } catch (error) {
        logger.error(`Error getting movie streams for ${imdbId}: ${error.message}`);
        return [];
    }
}

// Get series streams
async function getSeriesStreams(imdbId, season, episode) {
    const cacheKey = `series:${imdbId}:${season}:${episode}`;
    
    // Check cache first
    const cached = streamCache.get(cacheKey);
    if (cached) {
        logger.info(`Using cached streams for series ${imdbId} S${season}E${episode}`);
        return cached;
    }

    try {
        const metadata = await fetchOmdbDetails(imdbId);
        const streams = await getSimpleStreams({ type: 'series', imdbId, season, episode });
        
        const streamArray = Object.entries(streams).map(([name, url]) => ({
            name: `📺 ${name}`,
            url,
            title: `${metadata?.Title || 'Series'} S${season}E${episode}`,
            description: `Watch ${metadata?.Title || 'this episode'} in HD quality`
        }));

        // Cache the results
        streamCache.set(cacheKey, streamArray);
        return streamArray;
    } catch (error) {
        logger.error(`Error getting series streams for ${imdbId}: ${error.message}`);
        return [];
    }
}

// Define stream handler
builder.defineStreamHandler(async ({ type, id }) => {
    logger.info(`Stream request received: ${type}, ${id}`);
    
    try {
        if (type === 'movie') {
            const imdbId = id.split(':')[0];
            const streams = await getMovieStreams(imdbId);
            return { streams };
        }
        
        if (type === 'series') {
            const [imdbId, season, episode] = id.split(':');
            const streams = await getSeriesStreams(imdbId, season, episode);
            return { streams };
        }

        return { streams: [] };
    } catch (error) {
        logger.error(`Error in stream handler: ${error.message}`);
        return { streams: [] };
    }
});

// Enhanced CORS middleware
function setCorsHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.setHeader('Access-Control-Max-Age', '86400');
    res.setHeader('Cache-Control', 'public, max-age=1800'); // 30 minutes cache
}

// Vercel serverless function handler
module.exports = async (req, res) => {
    // Set CORS headers for all requests
    setCorsHeaders(res);
    
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }
    
    try {
        const path = req.url || '/';
        logger.info(`Request: ${req.method} ${path}`);
        
        // Handle manifest requests
        if (path === '/manifest.json' || path === '/') {
            const manifest = builder.getInterface().manifest;
            res.setHeader('Content-Type', 'application/json');
            res.status(200).json(manifest);
            return;
        }
        
        // Handle stream requests
        if (path.startsWith('/stream/')) {
            const pathParts = path.split('/');
            const type = pathParts[2];
            const id = pathParts[3];
            
            if (!type || !id) {
                logger.warn(`Invalid stream request: missing type or id`);
                res.status(400).json({ 
                    error: 'Missing type or id parameter',
                    streams: []
                });
                return;
            }
            
            const result = await builder.getInterface().get('stream', type, id);
            res.setHeader('Content-Type', 'application/json');
            res.status(200).json(result);
            return;
        }
        
        // Handle health check
        if (path === '/health') {
            res.status(200).json({ 
                status: 'ok', 
                timestamp: new Date().toISOString(),
                cache: {
                    keys: streamCache.keys().length,
                    stats: streamCache.getStats()
                }
            });
            return;
        }
        
        // 404 for unknown routes
        res.status(404).json({ 
            error: 'Not found',
            availableRoutes: ['/manifest.json', '/stream/{type}/{id}', '/health']
        });
        
    } catch (error) {
        logger.error(`API Error: ${error.message}`);
        res.status(500).json({ 
            error: 'Internal server error',
            message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
        });
    }
};
