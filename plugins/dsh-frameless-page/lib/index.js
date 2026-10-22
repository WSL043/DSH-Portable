/* dsh-frameless-page — 宿主半侧。
 * 页面本体全部在浏览器端（lib/client.js）；宿主侧没有路由、没有存储，
 * 只需要这条插件行存在，DSH 才会把 dsh.client 声明的浏览器模块编进
 * __DSH_BOOT__ 的模块图并挂载它。 */

const name = "dsh-frameless-page";

function apply() {}

export { apply, name };
