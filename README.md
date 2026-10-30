# 逐场英语（Scene by Scene）

选一部电影，按场景逐场攻克，最终无字幕看懂，并能开口把台词演出来。

需求和技术选型文档在需求讨论目录：`~/Documents/claude/scene-english/docs/`。

## 当前进度

阶段一：跑通导入和处理流水线。

- [x] 后端骨架：FastAPI + SQLAlchemy + Alembic + Celery
- [x] 流水线：音频预处理 → 分离人声（Demucs）→ 语音识别（MLX Whisper）→ 过滤幻听（Silero VAD + 识别置信度）→ 场景切分 → 生词候选 → 逐场生成学习内容（Claude）
- [x] 命令行工具：直接拿本地视频跑流水线，输出 JSON 和 Markdown 质量报告
- [ ] 用真实影片验证切分和内容质量
- [x] 前端：片库、导入（浏览器内算指纹、提取音轨、上传、看进度）、场景列表、四步学习（预习 / 精听 / 对戏 / 通关）
- [ ] 在真实浏览器里验证大文件的音轨提取（技术选型里的头号风险）
- [ ] 说话人区分（pyannote），目前由 LLM 根据上下文推断说话人
- [ ] 发音评分（阶段二），目前跟读和对戏只录音、回放，不打分

## 本地开发

需要：Docker、[uv](https://docs.astral.sh/uv/)、ffmpeg（`brew install uv ffmpeg`）。

```bash
# 1. 启动 PostgreSQL（5442 端口）和 Redis（6389 端口）
docker compose up -d

# 2. 安装依赖、配置、建表
cd backend
uv sync
cp .env.example .env          # 填上 ANTHROPIC_API_KEY
uv run alembic upgrade head

# 3. 启动 API（接口文档：http://127.0.0.1:8000/docs）
uv run uvicorn app.main:app --reload

# 4. 另开一个终端启动处理任务的 worker。macOS 上必须用 solo 模式
uv run celery -A app.worker worker --pool=solo --loglevel=info
```

```bash
# 5. 再开一个终端启动前端：http://127.0.0.1:5173
cd web
pnpm install
pnpm dev
```

前端通过 Vite 代理访问后端（`/api` → `127.0.0.1:8000`）。后端接口改了之后，运行 `pnpm gen:api` 重新生成 TypeScript 类型。

### 没有 API key 时先看效果

写入一份示例场景（台词是改写的，时间轴只是示意），用你本地的影片文件绑定：

```bash
cd backend
uv run scene-english seed-demo ~/Movies/Titanic.mp4
```

然后在网页的片库里打开它；精听、对戏、通关这几步会让你选择这个视频文件。

### 用命令行检查流水线质量

不用启动服务，直接处理本地视频的一段。开发时建议只处理 10 分钟（600 秒）：

```bash
cd backend

# 只做语音识别（不需要 API key）。第一次运行会下载约 1.6 GB 的 Whisper 模型和约 80 MB 的 Demucs 模型
# 行首 ? 表示识别没把握，最后会列出被当作幻听丢掉的句子；--no-separate 跳过人声分离（快一倍，但更不准）
uv run scene-english transcribe ~/Movies/Titanic.mp4 --start 41:00 --duration 600

# 完整流水线，结果写到 data/output/：.json 是学习数据，.md 是给人看的质量报告
uv run scene-english process ~/Movies/Titanic.mp4 --title 泰坦尼克号 --start 41:00 --duration 600

# 计算文件指纹（和网页端算法一致）
uv run scene-english fingerprint ~/Movies/Titanic.mp4
```

### 测试和代码检查

```bash
cd backend && uv run pytest && uv run ruff check app tests
cd web && pnpm test && pnpm build
```

## 目录

```
backend/
├── app/
│   ├── api/routes.py        # 接口
│   ├── models/              # 数据表：films / processing_jobs / scenes
│   ├── schemas/             # 接口的请求和响应模型
│   ├── pipeline/            # 流水线各步骤
│   │   ├── audio.py         #   ffmpeg 转 16 kHz 单声道
│   │   ├── speech.py        #   分离人声、人声检测、过滤幻听
│   │   ├── transcribe.py    #   MLX Whisper 识别，按句切分
│   │   ├── segment.py       #   场景切分（Claude）
│   │   ├── vocab.py         #   spaCy + wordfreq 找候选生词
│   │   ├── content.py       #   逐场生成翻译、声音标注、单词卡、测验（Claude）
│   │   ├── markup.py        #   连读弱读标注语法
│   │   ├── llm.py           #   Claude 调用：结构化输出、拒答回退、记账
│   │   ├── runner.py        #   串起整条流水线
│   │   └── report.py        #   Markdown 质量报告
│   ├── services/processing.py  # 后台任务：跑流水线、存结果、删上传的音轨
│   ├── worker.py            # Celery 入口
│   ├── cli.py               # 命令行工具
│   └── main.py              # FastAPI 入口
├── migrations/              # Alembic
└── tests/
web/
├── src/
│   ├── api/                 # 接口客户端；schema.d.ts 由 pnpm gen:api 生成
│   ├── lib/                 # 指纹、音轨提取、本地文件、播放控制、录音、IndexedDB
│   ├── pages/               # 片库、导入、影片、场景
│   └── features/scene/      # 播放器和字幕、单词卡、精听、对戏、通关
└── vite.config.ts           # PWA、接口代理
docker-compose.yml           # PostgreSQL + Redis
```

## 识别质量参考

用 [Tears of Steel](https://mango.blender.org/)（12 分钟，CC BY）和官方字幕对比，M1 上：

| | 直接识别混合音轨 | 先分离人声再识别 |
|---|---|---|
| 耗时 | 约 2.5 分钟 | 约 4.5 分钟 |
| 片尾、纯音乐段编出来的台词 | 有（"Thank you."、"Outro Music" 等） | 全部过滤掉 |
| 人声检测漏掉的官方台词 | 25 / 76 | 9 / 76（都是喊叫） |

剩下的问题：人名拼写（Thom → Tom）、喊叫和压在音效下的短句仍可能识别错，这类句子会标成"没把握"。

## 约定

- 视频文件不上传，服务器只接收音轨；上传的音轨处理完立即删除。
- 用户导入的影片只对本人可见。
- LLM 默认用 Claude Opus 5.5，可以在 `.env` 里按任务分别改（`LLM_MODEL_SEGMENT`、`LLM_MODEL_CONTENT`）。
