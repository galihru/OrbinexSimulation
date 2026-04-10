import { promises as fs } from "node:fs";
import path from "node:path";
import { minify as minifyHtml } from "html-minifier-terser";
import { minify as minifyJs } from "terser";

const DIST_DIR = path.resolve(process.cwd(), "dist");

const HTML_MINIFY_OPTIONS = {
    collapseWhitespace: true,
    removeComments: true,
    removeRedundantAttributes: true,
    removeScriptTypeAttributes: true,
    removeStyleLinkTypeAttributes: true,
    keepClosingSlash: true,
    useShortDoctype: true,
    minifyCSS: true,
    minifyJS: true,
};

const MODULE_JS_MINIFY_OPTIONS = {
    module: true,
    compress: {
        passes: 2,
        drop_console: true,
        drop_debugger: true,
        toplevel: true,
    },
    mangle: {
        toplevel: true,
    },
    format: {
        comments: false,
        ascii_only: true,
    },
};

const CLASSIC_JS_MINIFY_OPTIONS = {
    module: false,
    compress: {
        passes: 2,
        drop_console: true,
        drop_debugger: true,
        toplevel: true,
    },
    mangle: {
        toplevel: true,
    },
    format: {
        comments: false,
        ascii_only: true,
    },
};

const CLASS_MANGLE_EXCLUDE_PREFIXES = [
    "a-",
    "arjs-",
    "xr-",
    "hljs-",
];

async function walkFiles(dirPath) {
    const dirEntries = await fs.readdir(dirPath, { withFileTypes: true });
    const allFiles = [];

    for (const entry of dirEntries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            const nested = await walkFiles(fullPath);
            allFiles.push(...nested);
        } else if (entry.isFile()) {
            allFiles.push(fullPath);
        }
    }

    return allFiles;
}

function isClassicScript(filePath) {
    const normalized = filePath.replace(/\\/g, "/");
    return normalized.endsWith("/sw.js");
}

function shouldMangleClassName(className) {
    if (!className.includes("-")) {
        return false;
    }
    if (className.length < 4) {
        return false;
    }
    return !CLASS_MANGLE_EXCLUDE_PREFIXES.some((prefix) => className.startsWith(prefix));
}

function collectClassNamesFromCss(cssCode) {
    const classNames = new Set();
    const classPattern = /\.([_a-zA-Z]+[_a-zA-Z0-9-]*)/g;
    let match;
    while ((match = classPattern.exec(cssCode)) !== null) {
        const className = match[1];
        if (shouldMangleClassName(className)) {
            classNames.add(className);
        }
    }
    return classNames;
}

function collectClassNamesFromHtmlStyles(htmlCode) {
    const classNames = new Set();
    const stylePattern = /<style[^>]*>([\s\S]*?)<\/style>/gi;
    let styleMatch;
    while ((styleMatch = stylePattern.exec(htmlCode)) !== null) {
        const cssBlock = styleMatch[1] || "";
        const fromCss = collectClassNamesFromCss(cssBlock);
        fromCss.forEach((name) => classNames.add(name));
    }
    return classNames;
}

function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function applyClassMap(content, classMap) {
    const replacements = Array.from(classMap.entries()).sort((a, b) => b[0].length - a[0].length);
    let output = content;
    for (const [sourceName, targetName] of replacements) {
        const tokenPattern = new RegExp(`\\b${escapeRegExp(sourceName)}\\b`, "g");
        output = output.replace(tokenPattern, targetName);
    }
    return output;
}

async function mangleClassNames(files) {
    const cssFiles = files.filter((filePath) => path.extname(filePath).toLowerCase() === ".css");
    const htmlFiles = files.filter((filePath) => path.extname(filePath).toLowerCase() === ".html");
    const targetFiles = files.filter((filePath) => {
        const ext = path.extname(filePath).toLowerCase();
        return ext === ".css" || ext === ".js" || ext === ".html";
    });

    const discoveredClassNames = new Set();
    for (const cssFile of cssFiles) {
        const cssCode = await fs.readFile(cssFile, "utf8");
        const fromFile = collectClassNamesFromCss(cssCode);
        fromFile.forEach((name) => discoveredClassNames.add(name));
    }

    for (const htmlFile of htmlFiles) {
        const htmlCode = await fs.readFile(htmlFile, "utf8");
        const fromHtmlStyles = collectClassNamesFromHtmlStyles(htmlCode);
        fromHtmlStyles.forEach((name) => discoveredClassNames.add(name));
    }

    const classMap = new Map();
    let index = 0;
    for (const className of Array.from(discoveredClassNames).sort()) {
        classMap.set(className, `c${index.toString(36)}`);
        index += 1;
    }

    if (classMap.size === 0) {
        return { renamed: 0, reducedBytes: 0 };
    }

    let reducedBytes = 0;
    for (const filePath of targetFiles) {
        const original = await fs.readFile(filePath, "utf8");
        const updated = applyClassMap(original, classMap);
        if (updated !== original) {
            await fs.writeFile(filePath, updated, "utf8");
            reducedBytes += original.length - updated.length;
        }
    }

    return { renamed: classMap.size, reducedBytes };
}

async function minifyHtmlFile(filePath) {
    const original = await fs.readFile(filePath, "utf8");
    const minified = await minifyHtml(original, HTML_MINIFY_OPTIONS);
    if (minified.length < original.length) {
        await fs.writeFile(filePath, minified, "utf8");
        return original.length - minified.length;
    }
    return 0;
}

async function minifyJsFile(filePath) {
    const original = await fs.readFile(filePath, "utf8");
    const options = isClassicScript(filePath) ? CLASSIC_JS_MINIFY_OPTIONS : MODULE_JS_MINIFY_OPTIONS;
    const minified = await minifyJs(original, options);

    if (!minified.code) {
        return 0;
    }

    if (minified.code.length < original.length) {
        await fs.writeFile(filePath, minified.code, "utf8");
        return original.length - minified.code.length;
    }
    return 0;
}

async function optimizeDist() {
    const files = await walkFiles(DIST_DIR);
    let htmlCount = 0;
    let jsCount = 0;
    let reducedBytes = 0;

    for (const filePath of files) {
        const ext = path.extname(filePath).toLowerCase();
        if (ext === ".html") {
            reducedBytes += await minifyHtmlFile(filePath);
            htmlCount += 1;
        }
        if (ext === ".js") {
            reducedBytes += await minifyJsFile(filePath);
            jsCount += 1;
        }
    }

    const classMangleResult = await mangleClassNames(files);
    reducedBytes += classMangleResult.reducedBytes;

    const reducedKb = (reducedBytes / 1024).toFixed(2);
    console.log(
        `[postbuild-optimize] html=${htmlCount} js=${jsCount}`
        + ` classRenamed=${classMangleResult.renamed}`
        + ` reduced=${reducedKb}KB`,
    );
}

optimizeDist().catch((error) => {
    console.error("[postbuild-optimize] failed", error);
    process.exitCode = 1;
});
