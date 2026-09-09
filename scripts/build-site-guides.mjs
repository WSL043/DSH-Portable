import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const escape = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const origin = 'https://wsl043.github.io/DSH-Portable/';
export async function buildGuides(root, output, revision) {
  const guides = JSON.parse(await readFile(path.join(root,'docs/promotion/guides.json'),'utf8'));
  const drafts = path.join(root,'build/promotion');
  await mkdir(path.join(output,'guides'),{recursive:true});
  await mkdir(drafts,{recursive:true});
  for (const guide of guides) {
    if(!/^[a-z-]+$/.test(guide.slug)) throw new Error('Invalid guide slug');
    const url = `${origin}guides/${guide.slug}.html`;
    const html = [], markdown = [`# ${guide.title}`, '', guide.description, ''];
    for (const block of guide.body) {
      if (block.type === 'p') {html.push(`<p>${escape(block.text)}</p>`);markdown.push(block.text,'');}
      else if (block.type === 'h2') {html.push(`<h2>${escape(block.text)}</h2>`);markdown.push(`## ${block.text}`,'');}
      else if (block.type === 'steps') {html.push(`<ol>${block.items.map(item=>`<li>${escape(item)}</li>`).join('')}</ol>`);markdown.push(...block.items.map((item,i)=>`${i+1}. ${item}`),'');}
      else if (block.type === 'link') {html.push(`<p><a href="${escape(block.url)}">${escape(block.text)} ↗</a></p>`);markdown.push(`[${block.text}](${block.url})`,'');}
      else if (block.type === 'image') {html.push(`<figure><img src="../assets/${escape(block.src)}" alt="${escape(block.alt)}" loading="lazy"><figcaption>${escape(block.caption)}</figcaption></figure>`);markdown.push(`![${block.alt}](${origin}assets/${block.src})`,block.caption,'');}
      else throw new Error(`Unknown guide block: ${block.type}`);
    }
    const schema = { '@context':'https://schema.org', '@type':'Article', headline:guide.title,description:guide.description,inLanguage:'zh-CN',datePublished:guide.date,dateModified:guide.date,author:{'@type':'Person',name:'WSL043',url:'https://github.com/WSL043'},mainEntityOfPage:url };
    const page = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(guide.title)}｜DSH-Portable</title><meta name="description" content="${escape(guide.description)}">
<link rel="canonical" href="${url}"><meta property="og:type" content="article"><meta property="og:title" content="${escape(guide.title)}"><meta property="og:description" content="${escape(guide.description)}"><meta property="og:url" content="${url}"><meta property="og:image" content="${origin}assets/dsh-interface-zh.png"><meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="../assets/DSH-Portable.svg"><link rel="stylesheet" href="../styles.css?v=${revision}"><script src="../guide.js?v=${revision}" defer></script>
<script type="application/ld+json">${JSON.stringify(schema).replaceAll('<','\\u003c')}</script></head><body>
<a class="skip-link" href="#article">跳到文章</a><header class="site-header"><a class="brand" href="../"><img src="../assets/DSH-Portable-white.svg" alt="" width="30" height="30">DSH-Portable</a><nav><a href="../#downloads">下载</a><button class="theme-toggle" type="button" data-guide-theme>切换外观</button></nav></header>
<main class="guide-article" id="article"><p class="eyebrow">DSH-PORTABLE / 使用指南</p><h1>${escape(guide.title)}</h1><p class="guide-byline">WSL043 · ${guide.date} · 独立社区发行版</p>${html.join('\n')}</main>
<footer><a href="../">← 返回官网</a><a href="https://github.com/WSL043/DSH-Portable">在 GitHub 上 Star ↗</a><p>DeepSeek Harness 与其标志归 DeepSeek 所有。DSH-Portable 由 WSL043 独立维护。</p></footer></body></html>`;
    await writeFile(path.join(output,'guides',guide.slug+'.html'),page);
    markdown.push(`原文：${url}`,'作者：WSL043（DSH-Portable 维护者）','');
    await writeFile(path.join(drafts,guide.slug+'.md'),markdown.join('\n'));
  }
}
