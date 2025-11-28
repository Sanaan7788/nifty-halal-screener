
import { chromium, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

// ==========================================
// 1. CONFIGURATION
// ==========================================
const CONFIG = {
    INPUT_FILE: 'nifty50_final.csv',
    CSV_OUTPUT: 'halal_report.csv',
    HTML_OUTPUT: 'index.html',
    SCREENSHOT_DIR: 'screenshots',
    WAIT_TIME: 1500 // Time to wait between actions
};

// ==========================================
// 2. HELPER METHODS
// ==========================================

function loadNiftySymbols(): string[] {
    const inputPath = path.resolve(__dirname, CONFIG.INPUT_FILE);
    if (!fs.existsSync(inputPath)) {
        console.error("❌ Input file not found!");
        return [];
    }

    const rawLines = fs.readFileSync(inputPath, 'utf-8').split('\n');
    const validSymbols: string[] = [];
    const symbolPattern = /^[A-Z0-9&]+$/;

    // Start from row 2
    for (let i = 2; i < rawLines.length; i++) {
        const cols = rawLines[i].split(',');
        let sym = cols[0]?.replace(/"/g, '').trim();

        if (sym && symbolPattern.test(sym) && sym !== 'NIFTY 50') {
            validSymbols.push(sym);
        }
    }

    // PRODUCTION MODE: Return ALL symbols (No slicing)
    console.log(`✅ Loaded ${validSymbols.length} Symbols. Starting Audit...`);
    return validSymbols;
}

/**
 * CSS INJECTION: The "Invisibility Cloak" for Popups
 */
async function injectCssKiller(page: Page) {
    const css = `
        /* Hide the Invest/Riba Free Modal */
        app-riba-modal, .riba_free_modal, .modal-content {
            display: none !important;
            visibility: hidden !important;
            opacity: 0 !important;
            pointer-events: none !important;
        }
        
        /* Hide the Dark Backdrop */
        .modal-backdrop, .backdrop, .cdk-overlay-backdrop {
            display: none !important;
            width: 0 !important;
            height: 0 !important;
        }

        /* Hide specific Angular modals */
        .modal { display: none !important; }
        
        /* Unlock scrolling */
        body { overflow: auto !important; padding-right: 0 !important; }
    `;

    await page.addStyleTag({ content: css });
}

async function captureEvidence(page: Page, symbol: string): Promise<string> {
    const screenshotPath = path.resolve(__dirname, CONFIG.SCREENSHOT_DIR);
    if (!fs.existsSync(screenshotPath)) fs.mkdirSync(screenshotPath);

    const imgName = `${symbol}.png`;
    const fullPath = path.join(screenshotPath, imgName);

    // Capture the visible viewport
    await page.screenshot({ path: fullPath });
    return `${CONFIG.SCREENSHOT_DIR}/${imgName}`;
}

// ==========================================
// 3. CORE LOGIC
// ==========================================

async function processStock(page: Page, symbol: string) {
    let musaffaName = "-";
    let status = "SKIPPED";
    let imgPath = "No Image";

    try {
        console.log(`\n🔍 Processing: ${symbol}`);

        // Re-apply CSS Killer on every page load
        await injectCssKiller(page);

        // --- STEP A: SEARCH ---
        const searchBar = page.getByPlaceholder('Search Stocks & ETFs');
        await searchBar.click({ force: true });
        await searchBar.fill(symbol);
        await page.waitForTimeout(2000);

        // --- STEP B: SELECT ---
        const dropdownItems = page.locator('.stock-name');
        const count = await dropdownItems.count();

        if (count === 0) throw new Error("Dropdown empty");

        let clicked = false;
        for (let i = 0; i < count; i++) {
            const text = await dropdownItems.nth(i).innerText();
            if (text.includes(symbol)) {
                await dropdownItems.nth(i).click({ force: true });
                clicked = true;
                break;
            }
        }
        if (!clicked) await dropdownItems.first().click({ force: true });

        // --- STEP C: EXTRACT DATA ---
        // 1. Get Name
        try {
            const nameEl = page.locator('.company-name').first();
            if (await nameEl.isVisible()) musaffaName = await nameEl.innerText();
        } catch (e) { }

        // 2. Get Status
        const statusLocator = page.locator('.compliance-chip h5.status-text');
        await statusLocator.waitFor({ state: 'visible', timeout: 5000 });
        status = (await statusLocator.innerText()).replace(/\n/g, ' ').trim();

        console.log(`   👉 Found: ${musaffaName} | Status: ${status}`);

    } catch (error: any) {
        console.log(`❌ Failed: ${error.message}`);
    }

    // Always take evidence
    try {
        imgPath = await captureEvidence(page, symbol);
    } catch (e) { console.log("   ⚠️ Could not save screenshot"); }

    return { symbol, musaffaName, status, imgPath };
}

// ==========================================
// 4. REPORT GENERATOR
// ==========================================

function generateHtmlReport() {
    if (!fs.existsSync(CONFIG.CSV_OUTPUT)) return;
    const csvData = fs.readFileSync(CONFIG.CSV_OUTPUT, 'utf-8').split('\n');

    let html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Nifty 50 Halal Screener</title>
        <style>
            body { font-family: sans-serif; padding: 20px; background: #f8f9fa; }
            .container { max-width: 1200px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th { background: #343a40; color: white; padding: 12px; text-align: left; }
            td { padding: 12px; border-bottom: 1px solid #dee2e6; vertical-align: middle; }
            
            .badge { padding: 5px 10px; border-radius: 4px; font-weight: bold; font-size: 0.85em; }
            .HALAL { background: #d4edda; color: #155724; }
            .NOT { background: #f8d7da; color: #721c24; }
            .DOUBTFUL { background: #fff3cd; color: #856404; }
            .SKIPPED { background: #e2e3e5; color: #383d41; text-decoration: line-through; }
            
            .thumb { height: 50px; border: 1px solid #ddd; cursor: pointer; transition: 0.2s; }
            .thumb:hover { transform: scale(3); z-index: 10; border-color: #333; position: relative; }

            /* Lightbox */
            .modal { display: none; position: fixed; z-index: 1000; left: 0; top: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.9); }
            .modal-content { display: block; max-width: 90%; max-height: 90%; margin: 50px auto; }
            .close { position: absolute; top: 20px; right: 35px; color: #fff; font-size: 40px; cursor: pointer; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>📊 Nifty 50 Halal Screener</h1>
            <table>
                <tr><th>#</th><th>Symbol</th><th>Company Name</th><th>Status</th><th>Evidence</th></tr>
    `;

    let counter = 1;
    for (let i = 1; i < csvData.length; i++) {
        const row = csvData[i].split(',');
        if (row.length < 4) continue;
        const [sym, name, status, img] = row;

        let badgeClass = status;
        if (status.includes('NOT')) badgeClass = 'NOT';

        html += `<tr>
            <td style="text-align:center; color:#888;">${counter++}</td>
            <td><strong>${sym}</strong></td>
            <td>${name.replace(/"/g, '')}</td>
            <td><span class="badge ${badgeClass}">${status}</span></td>
            <td><img src="${img}" class="thumb" onclick="openModal(this.src)"></td>
        </tr>`;
    }
    html += `</table></div>
    <div id="myModal" class="modal" onclick="this.style.display='none'">
        <span class="close">&times;</span>
        <img class="modal-content" id="img01">
    </div>
    <script>
        function openModal(src) {
            document.getElementById("myModal").style.display = "block";
            document.getElementById("img01").src = src;
        }
    </script>
    </body></html>`;

    fs.writeFileSync(CONFIG.HTML_OUTPUT, html);
    console.log(`\n✨ REPORT READY: ${CONFIG.HTML_OUTPUT}`);
}

// ==========================================
// 5. MAIN EXECUTION
// ==========================================

async function main() {
    const symbols = loadNiftySymbols();
    fs.writeFileSync(CONFIG.CSV_OUTPUT, 'Symbol,Name,Status,Screenshot\n');

    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    const page = await context.newPage();

    await page.goto('https://musaffa.com', { waitUntil: 'domcontentloaded' });

    await injectCssKiller(page);

    for (const sym of symbols) {
        const result = await processStock(page, sym);
        const csvLine = `${result.symbol},"${result.musaffaName}",${result.status},${result.imgPath}\n`;
        fs.appendFileSync(CONFIG.CSV_OUTPUT, csvLine);

        // Reset Page
        await page.goto('https://musaffa.com');
        await page.waitForTimeout(1000);
    }

    generateHtmlReport();
    await browser.close();
}

main();