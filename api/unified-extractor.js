const { connect } = require("puppeteer-real-browser");
const logger = require("./logger");

const extractors = {
    broflix: (type, id, season, episode) =>
        type === 'movie'
            ? `https://broflix.si/watch/movie/${id}`
            : `https://broflix.si/watch/tv/${id}?season=${season}&episode=${episode}`,
    fmovies: (type, id, season, episode) =>
        type === 'movie'
            ? `https://fmovies.cat/watch/movie/${id}`
            : `https://fmovies.cat/watch/tv/${id}/${season}/${episode}`,
    videasy: (type, id, season, episode) =>
        type === 'movie'
            ? `https://player.videasy.net/movie/${id}`
            : `https://player.videasy.net/tv/${id}/${season}/${episode}`,
    vidora: (type, id, season, episode) =>
        type === 'movie'
            ? `https://watch.vidora.su/watch/movie/${id}`
            : `https://watch.vidora.su/watch/tv/${id}/${season}/${episode}`,
    vidsrc: (type, id, season, episode) =>
        type === 'movie'
            ? `https://vidsrc.xyz/embed/movie/${id}`
            : `https://vidsrc.xyz/embed/tv/${id}/${season}/${episode}`,
    vilora: (type, id, season, episode) =>
        type === 'movie'
            ? `https://veloratv.ru/watch/movie/${id}`
            : `https://veloratv.ru/watch/tv/${id}/${season}/${episode}`,
    vidfast: (type, id, season, episode) =>
        type === 'movie'
            ? `https://vidfast.pro/embed/movie/${id}`
            : `https://vidfast.pro/embed/tv/${id}/${season}/${episode}`
};

function randomUserAgent() {
    const versions = ['119.0.6045.105', '118.0.5993.117', '117.0.5938.149'];
    const version = versions[Math.floor(Math.random() * versions.length)];
    return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`;
}

async function runExtractor(source, type, imdbId, season = null, episode = null) {
    if (!extractors[source]) {
        throw new Error(`Unknown source: ${source}`);
    }

    const streamUrls = {};
    const url = extractors[source](type, imdbId, season, episode);
    
    let browser = null;
    let page = null;

    try {
        logger.info(`[${source}] Starting extraction for ${url}`);

        const { browser: browserInstance, page: pageInstance } = await connect({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-web-security',
                '--disable-dev-shm-usage',
                '--disable-features=IsolateOrigins,site-per-process',
                '--enable-popup-blocking',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding',
                '--no-first-run',
                '--disable-default-apps'
            ],
            turnstile: true,
            customConfig: {},
            connectOption: {
                defaultViewport: {
                    width: 1920,
                    height: 1080
                }
            },
            disableXvfb: false,
            ignoreAllFlags: false,
        });

        browser = browserInstance;
        page = pageInstance;

        // Set user agent and headers
        await page.setUserAgent(randomUserAgent());
        await page.setExtraHTTPHeaders({
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Cache-Control': 'max-age=0'
        });

        // Block unnecessary resources and track streams
        await page.setRequestInterception(true);

        page.on('request', async (request) => {
            const requestUrl = request.url();
            
            // Block unwanted resources
            if (
                requestUrl.includes('analytics') ||
                requestUrl.includes('ads') ||
                requestUrl.includes('social') ||
                requestUrl.includes('disable-devtool') ||
                requestUrl.includes('cloudflareinsights') ||
                requestUrl.includes('ainouzaudre') ||
                requestUrl.includes('pixel.embed') ||
                requestUrl.includes('histats') ||
                requestUrl.includes('google-analytics') ||
                requestUrl.includes('googletagmanager') ||
                requestUrl.includes('facebook') ||
                requestUrl.includes('twitter') ||
                requestUrl.match(/\.(png|jpg|jpeg|gif|css|woff|woff2)$/i)
            ) {
                await request.abort();
                return;
            }

            // Detect stream URLs
            if (
                requestUrl.includes('.mp4') || 
                requestUrl.includes('.m3u8') || 
                requestUrl.includes('/mp4') ||
                requestUrl.includes('manifest.m3u8') ||
                requestUrl.includes('playlist.m3u8') ||
                (requestUrl.includes('stream') && (requestUrl.includes('.mp4') || requestUrl.includes('.m3u8')))
            ) {
                logger.info(`[${source}] Stream URL detected: ${requestUrl}`);
                streamUrls[`${source} Link`] = requestUrl;
            }

            await request.continue();
        });

        // Handle dialogs
        page.on('dialog', async (dialog) => {
            logger.info(`[${source}] Dialog detected: ${dialog.message()}`);
            await dialog.accept();
        });

        // Block new windows/popups
        await page.evaluateOnNewDocument(() => {
            window.open = () => null;
            window.alert = () => null;
            window.confirm = () => true;
            window.prompt = () => null;
        });

        // Navigate to the page
        logger.info(`[${source}] Navigating to ${url}`);
        await page.goto(url, { 
            waitUntil: 'domcontentloaded', 
            timeout: 15000 
        });

        // Wait a bit for the page to load
        await page.waitForTimeout(2000);

        // Source-specific interactions
        try {
            if (source === 'videasy') {
                const playButton = await page.$('button');
                if (playButton) {
                    await playButton.click();
                    logger.info(`[${source}] Clicked play button`);
                    await page.waitForTimeout(2000);
                }
            }

            if (source === 'vidsrc') {
                try {
                    await page.waitForSelector('iframe', { timeout: 5000 });
                    const iframe = await page.$('iframe');
                    if (iframe) {
                        const frame = await iframe.contentFrame();
                        if (frame) {
                            const playButton = await frame.$('#pl_but');
                            if (playButton) {
                                await playButton.click();
                                logger.info(`[${source}] Clicked vidsrc play button`);
                                await page.waitForTimeout(3000);
                            }
                        }
                    }
                } catch (e) {
                    logger.warn(`[${source}] Could not interact with iframe: ${e.message}`);
                }
            }

            if (source === 'vidfast') {
                // Wait for potential play button or auto-play
                await page.waitForTimeout(3000);
                
                // Look for common play button selectors
                const playSelectors = [
                    'button[aria-label*="play"]',
                    '.play-button',
                    '.vjs-big-play-button',
                    '[data-testid="play-button"]',
                    'button:contains("Play")'
                ];

                for (const selector of playSelectors) {
                    try {
                        const button = await page.$(selector);
                        if (button) {
                            await button.click();
                            logger.info(`[${source}] Clicked play button with selector: ${selector}`);
                            await page.waitForTimeout(2000);
                            break;
                        }
                    } catch (e) {
                        // Continue to next selector
                    }
                }
            }

        } catch (interactionError) {
            logger.warn(`[${source}] Interaction error: ${interactionError.message}`);
        }

        // Wait for stream URLs to be detected
        logger.info(`[${source}] Waiting for stream URLs...`);
        
        const maxWaitTime = 15000; // 15 seconds
        const checkInterval = 500;
        let waitTime = 0;

        while (Object.keys(streamUrls).length === 0 && waitTime < maxWaitTime) {
            await page.waitForTimeout(checkInterval);
            waitTime += checkInterval;
            
            // Log progress every 5 seconds
            if (waitTime % 5000 === 0) {
                logger.info(`[${source}] Still waiting... (${waitTime/1000}s)`);
            }
        }

        if (Object.keys(streamUrls).length > 0) {
            logger.info(`[${source}] Successfully found ${Object.keys(streamUrls).length} stream(s)`);
            return streamUrls;
        } else {
            logger.warn(`[${source}] No streams found after ${waitTime/1000}s`);
            return {};
        }

    } catch (error) {
        logger.error(`[${source}] Extraction error: ${error.message}`);
        return {};
    } finally {
        if (browser) {
            try {
                await browser.close();
                logger.info(`[${source}] Browser closed`);
            } catch (closeError) {
                logger.error(`[${source}] Error closing browser: ${closeError.message}`);
            }
        }
    }
}

module.exports = runExtractor;
