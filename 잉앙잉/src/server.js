import { createApp } from "./app.js";
import { config } from "./config.js";

const app = await createApp();

app.listen(config.port, () => {
  console.log(`AI 학습 도구 MVP가 http://localhost:${config.port} 에서 실행 중입니다.`);
});
