// 内联 semver 比较,避免引入 semver 依赖 (我们只需要比较 x.y.z)

// 解析 semver 字符串为 [major, minor, patch]
function parse(v: string): [number, number, number] {
    const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
    if (!m) return [0, 0, 0];
    return [Number(m[1]), Number(m[2]), Number(m[3])];
}

// 比较两个 semver 版本: -1 / 0 / 1
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
    const [a1, a2, a3] = parse(a);
    const [b1, b2, b3] = parse(b);
    if (a1 !== b1) return a1 < b1 ? -1 : 1;
    if (a2 !== b2) return a2 < b2 ? -1 : 1;
    if (a3 !== b3) return a3 < b3 ? -1 : 1;
    return 0;
}
