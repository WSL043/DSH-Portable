export function compareVersions(left, right) {
  const parse = value => {
    if (typeof value !== 'string' || value.length > 128 || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[a-zA-Z0-9]+(?:\.[a-zA-Z0-9]+)*)?$/.test(value)) throw new Error('Unsupported desktop version');
    const [base, pre] = value.split('-');
    const parts = pre?.split('.');
    if (parts?.some(p => /^0\d+$/.test(p))) throw new Error('Invalid numeric prerelease');
    return {base:base.split('.').map(BigInt), pre:parts};
  };
  const a=parse(left),b=parse(right);
  for(let i=0;i<3;i++)if(a.base[i]!==b.base[i])return a.base[i]>b.base[i]?1:-1;
  if(!a.pre||!b.pre)return a.pre? -1:b.pre?1:0;
  for(let i=0;i<Math.min(a.pre.length,b.pre.length);i++){
    const x=a.pre[i],y=b.pre[i];if(x===y)continue;
    const xn=/^\d+$/.test(x),yn=/^\d+$/.test(y);
    if(xn&&yn)return BigInt(x)>BigInt(y)?1:-1;
    if(xn!==yn)return xn?-1:1;
    return x>y?1:-1;
  }
  return Math.sign(a.pre.length-b.pre.length);
}
