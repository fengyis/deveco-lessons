# 安装疑难排查

`./setup.sh` 幂等可重跑;装到一半失败,先 `rm -rf vendor/cannbot-insight/node_modules` 再重跑。

## better-sqlite3(原生扩展)装不上

装依赖时按顺序走三条路,三条全不通才失败:

1. **仓库离线包**(`vendor/prebuilds/`,Windows x64 已覆盖 node 20/22/23)——命中即不联网;
2. **npmmirror 镜像下载**(setup.sh 已内置,不走 GitHub);
3. **本机源码编译**(需要 VS Build Tools + Python)。

推荐 node 20/22 LTS。node 24+ 官方没有预编译包,有工具链的机器可以自编一份供全班离线复用——在装好依赖的 better-sqlite3 目录里(此时 npm 已现场编译成功)打包:

```bash
cd vendor/cannbot-insight/node_modules/better-sqlite3
ABI=$(node -e "console.log(process.versions.modules)")          # node 24 是 137
PLAT=$(node -e "console.log(process.platform + '-' + process.arch)")
tar -czf ../../../prebuilds/better-sqlite3-v11.10.0-node-v${ABI}-${PLAT}.tar.gz \
    build/Release/better_sqlite3.node
```

其他机器装依赖时会直接命中这个包,不触发本机编译。

报错时先看输出里 `prebuild-install` 那行的 `target=x.y.z`——那才是 npm 实际用的 node,多套 node 共存时和 `node -v` 可能不是同一个。多版本共存用 [nvm-windows](https://github.com/coreybutler/nvm-windows):`nvm install 20.19.5 && nvm use 20.19.5`。

## EINTEGRITY(npm ci 校验和不匹配)

先 `npm cache clean --force` 重试;仍失败则 `npm config get registry` 看源——lockfile 钉的是官方源,公司内部源重新打包过的 tarball 校验和对不上。能直连就 `npm ci --registry=https://registry.npmjs.org`;只能走内部源就删掉 `node_modules` 和 `package-lock.json` 后 `npm install` 重新生成。

## prisma 报错(binaries.prisma.sh 连不上 / checksum 失败)

Prisma 引擎二进制走独立 CDN,公司网络常被挡。本仓已自带 Windows 的两个引擎(`vendor/prebuilds/prisma/windows/`,校验和与官方一致),setup.sh 会种进 Prisma 本地缓存,generate/migrate 直接命中、不联网;同时默认设了 npmmirror 镜像(`PRISMA_ENGINES_MIRROR`,可覆盖)兜底。

## bun 装不上

setup.sh 首选 `npm install -g bun`(走 npm 源,可吃镜像配置),失败才退回官方安装脚本。手动装:https://bun.sh 。bun 只有第三课的测试用,不影响前两课。

## 其他

- sqlite3 命令行不需要装,观测脚本会用 vendor 里的 better-sqlite3 兜底。
- Windows 全流程在 Git Bash 里跑;或者直接用 WSL2,和 macOS/Linux 完全同一套。
