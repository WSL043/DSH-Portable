import { Component, createElement as h, useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Button, Modal, IconCordisPluginOutline14, IconLinkOutline14 } from './primitives.ts'
import { CardPreview } from './CardPreview.tsx'
import { DownloadCount } from './DownloadCount.tsx'
import { categoryText, formatCount, localizedText, pluginName, visiblePlugins, type Registry, type RegistryPlugin } from './market-data.ts'
import { en, zh } from './locales.ts'
import css from './Market.module.css'
import page from './OfficialMarket.module.css'

export const name = 'portable-market'
export const inject = ['slots', 'locale', 'remote', 'remote.pluginManager', 'pluginNavigation']

class CatalogBoundary extends Component<{ children: ReactNode; chinese: boolean }, { error: string }> {
  state = { error: '' }
  static getDerivedStateFromError(error: Error) { return { error: error.message || String(error) } }
  componentDidCatch(error: Error) { console.error('Portable market render failed:', error) }
  render() {
    if (!this.state.error) return this.props.children
    return <section className={page.page} role="alert"><h2>{this.props.chinese ? '插件市场暂时无法显示' : 'Plugin market could not be displayed'}</h2><p>{this.state.error}</p><Button variant="outline" onClick={() => this.setState({ error: '' })}>{this.props.chinese ? '重试' : 'Retry'}</Button></section>
  }
}

interface OfficialActions { refresh: () => void; openInstall: () => void; editInstallSpec: (spec: string) => void }
function Catalog({ ctx, onInstall, onManage }: { ctx: any; onInstall: (spec:string)=>void; onManage:(name:string)=>void }) {
  const locale = useSyncExternalStore((f: () => void) => ctx.locale.subscribe(f), () => ctx.locale.getSnapshot()) as { active: string }
  const chinese = locale.active.toLowerCase().startsWith('zh'), lang = chinese ? 'zh' : 'en'
  const t = (key: string) => String((chinese ? zh : en)[key as keyof typeof en] ?? key)
  const [registry, setRegistry] = useState<Registry | null>(null)
  const [bundles, setBundles] = useState<any[]>([])
  const [error, setError] = useState('')
  const [query, setQuery] = useState(''), [category, setCategory] = useState('all')
  const [sort, setSort] = useState('downloads-desc'), [current, setCurrent] = useState(1)
  const [compact, setCompact] = useState(false)
  const [loading, setLoading] = useState(false)
  const [confirming, setConfirming] = useState<RegistryPlugin | null>(null)
  const [preview, setPreview] = useState<{shots:string[];index:number} | null>(null)
  const [beta, setBeta] = useState(false)
  // Dynamic-plugin service facades may be recreated on property access.
  // Capture one per mount; otherwise every inventory response restarts loading.
  const manager = useMemo(() => ctx.remote.pluginManager, [ctx])
  const refreshInstalled = useCallback(async () => {
    const result = await manager.listBundles()
    if (!result.ok) throw new Error(result.error?.message ?? 'Official plugin inventory unavailable')
    if (!Array.isArray(result.value)) throw new Error('Unexpected official plugin inventory response')
    setBundles(result.value)
  }, [manager])
  const load = useCallback(async (refresh = false, signal?: AbortSignal) => {
    setLoading(true); setError('')
    try {
      const deadline = AbortSignal.timeout(45000)
      const response = await fetch(`/dsh-market/registry?mode=${refresh ? 'refresh' : 'cache'}`, { signal: signal ? AbortSignal.any([signal, deadline]) : deadline })
      const body = await response.json()
      if (!response.ok) throw Error(body.error ?? `HTTP ${response.status}`)
      if (!signal?.aborted) setRegistry(body.registry)
    } catch (error) { if (!signal?.aborted) setError(String(error)) }
    finally { if (!signal?.aborted) setLoading(false) }
  }, [])
  useEffect(() => {
    const abort = new AbortController()
    void load(false, abort.signal); void refreshInstalled().catch(e => setError(String(e)))
    const off = ctx.remote.$on('plugin-manager/changed', () => { void refreshInstalled().catch(e => setError(String(e))) })
    return () => { abort.abort(); off() }
  }, [ctx, load, refreshInstalled])
  useEffect(() => { setCurrent(1) }, [query, category, sort])
  const filtered = useMemo(() => visiblePlugins(registry?.plugins ?? [], { category, query, lang, sort }), [registry, category, query, lang, sort])
  const pages = Math.max(1, Math.ceil(filtered.length / 20)), selectedPage = Math.min(current, pages)
  const installed = (p: RegistryPlugin) => bundles.find(b => b.name === p.npm || b.name === p.name)
  const openDetails = (p: RegistryPlugin) => onManage(installed(p)?.name ?? p.npm ?? p.name)
  const install = () => {
    const p = confirming
    if (!p) return
    const spec = p.npm ? `${p.npm}@${beta ? 'beta' : 'latest'}` : p.tarball || p.url
    setConfirming(null); onInstall(spec)
  }
  return <section className={page.page} aria-label={t('nav')}>
    <header className={page.header}><Button size="sm" variant="outline" disabled={loading} onClick={() => void load(true)}>{chinese ? '刷新' : 'Refresh'}</Button></header>
    <div className={page.filters}>
      <input aria-label={t('searchPh')} placeholder={t('searchPh')} value={query} onChange={e => setQuery(e.target.value)} />
      <select aria-label={chinese ? '分类' : 'Category'} value={category} onChange={e => setCategory(e.target.value)}><option value="all">{t('all')}</option>{Object.entries(registry?.categories ?? {}).map(([key, value]) => <option key={key} value={key}>{localizedText(value, lang)}</option>)}</select>
      <select aria-label={chinese ? '排序' : 'Sort'} value={sort} onChange={e => setSort(e.target.value)}><option value="downloads-desc">{chinese ? '近 30 天下载最多' : 'Most downloads (30 days)'}</option><option value="stars-desc">{chinese ? '星标最多' : 'Most stars'}</option><option value="added-desc">{chinese ? '最新收录' : 'Recently added'}</option></select>
      <Button size="sm" variant="outline" onClick={() => setCompact(!compact)}>{compact ? (chinese ? '图文' : 'Gallery') : (chinese ? '紧凑' : 'Compact')}</Button>
    </div>
    {error && <div role="alert" className={page.error}>{error}<Button size="sm" variant="outline" onClick={() => void load(true)}>{chinese ? '重试' : 'Retry'}</Button></div>}
    {!registry && loading && <p role="status">{chinese ? '正在加载插件…' : 'Loading plugins…'}</p>}
    <div className={page.list}><div className={compact ? page.compact : css.grid}>{filtered.slice((selectedPage - 1) * 20, selectedPage * 20).map(p => <article key={p.url} data-market-card className={`${css.card}${compact ? ` ${css.compactCard}` : ''}`}>
      <div className={css.cardContent}><div className={css.nm}><button className={css.nameButton} onClick={() => { setBeta(false); setConfirming(p) }}>{pluginName(p.name)}</button><a className={css.projectLinkIcon} href={p.url} target="_blank" rel="noreferrer" aria-label={t('openProject')}><IconLinkOutline14 size={13} /></a></div>
        <div className={css.byline}><span className={css.owner}>{p.owner}</span>{p.npm && <DownloadCount name={p.npm} chinese={chinese} className={css.star} />}{typeof p.stars === 'number' && <span className={css.star} title="GitHub stars">· ★ {formatCount(p.stars)}</span>}</div>
        <div className={css.desc}>{localizedText(p.description, lang)}</div>{p.deprecated && <span className={css.depBadge}>{t('deprecatedBadge')}</span>}
      </div>
      <CardPreview plugin={p} t={t} onOpen={(shots, index) => setPreview({shots,index})} />
      <div className={css.cardFooter}><span className={css.tag}>{categoryText(p.category, registry!.categories, lang)}</span><Button size="sm" variant={installed(p) ? 'outline' : 'primary'} onClick={() => installed(p) ? openDetails(p) : onInstall(p.npm ? `${p.npm}@latest` : p.tarball || p.url)}>{installed(p) ? (chinese ? '管理' : 'Manage') : t('install')}</Button></div>
    </article>)}</div></div>
    {registry && <footer className={page.pagination}><span>{filtered.length} {chinese ? '个插件' : 'plugins'}</span><Button size="sm" variant="outline" disabled={selectedPage <= 1} onClick={() => setCurrent(selectedPage - 1)}>‹</Button><span>{selectedPage} / {pages}</span><Button size="sm" variant="outline" disabled={selectedPage >= pages} onClick={() => setCurrent(selectedPage + 1)}>›</Button></footer>}
    <Modal open={confirming !== null} onClose={() => setConfirming(null)} title={confirming ? pluginName(confirming.name) : ''} closeLabel={t('cancel')}>
      <p>{localizedText(confirming?.description, lang)}</p>
      {confirming?.npm && <label><input type="checkbox" checked={beta} onChange={e => setBeta(e.target.checked)} /> {chinese ? '使用 Beta 通道' : 'Use Beta channel'}</label>}
      {error && <p role="alert" className={page.error}>{error}</p>}
      <div className={page.actions}><Button variant="outline" onClick={() => setConfirming(null)}>{t('cancel')}</Button><Button onClick={install}>{t('install')}</Button></div>
    </Modal>
    <Modal open={preview !== null} onClose={() => setPreview(null)} title={chinese ? '截图预览' : 'Screenshot'} closeLabel={t('cancel')}><img className={page.preview} src={preview?.shots[preview.index]} alt={chinese ? '插件截图' : 'Plugin screenshot'} />{preview && preview.shots.length>1 && <div className={page.actions}><Button variant="outline" disabled={preview.index===0} onClick={()=>setPreview({...preview,index:preview.index-1})}>‹</Button><span>{preview.index+1}/{preview.shots.length}</span><Button variant="outline" disabled={preview.index===preview.shots.length-1} onClick={()=>setPreview({...preview,index:preview.index+1})}>›</Button></div>}</Modal>
  </section>
}

function MarketAction({ctx, actions}:{ctx:any;actions:OfficialActions}) {
  const [open,setOpen]=useState(false)
  const locale=useSyncExternalStore((f:()=>void)=>ctx.locale.subscribe(f),()=>ctx.locale.getSnapshot()) as {active:string}
  const chinese=locale.active.toLowerCase().startsWith('zh'), title=chinese?'插件市场':'Plugin Market'
  const close=()=>{setOpen(false);actions.refresh()}
  const onInstall=(spec:string)=>{setOpen(false);actions.openInstall();actions.editInstallSpec(spec)}
  const onManage=(name:string)=>{setOpen(false);ctx.pluginNavigation.openBundle(name)}
  return <><Button type="button" variant="outline" size="sm" icon={<IconCordisPluginOutline14 size={14}/>} onClick={()=>setOpen(true)}>{title}</Button>
    <Modal open={open} onClose={close} title={title} closeLabel={chinese?'关闭':'Close'} className={css.managerModal} contentClassName={css.managerModalContent}>
      <CatalogBoundary chinese={chinese}><Catalog ctx={ctx} onInstall={onInstall} onManage={onManage}/></CatalogBoundary>
    </Modal></>
}
export function apply(ctx: any): void {
  ctx.slots.inject('plugins.portable.actions', () => ctx.slots.register({name:'plugins.portable.actions',id:'dsh-portable-plugin-market',order:40}, (actions:OfficialActions)=>h(MarketAction,{ctx,actions})))
}
