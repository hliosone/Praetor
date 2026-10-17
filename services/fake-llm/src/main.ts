import { createFakeLlm } from './app.js';

const port = Number(process.env.PORT ?? 3090);
createFakeLlm().listen(port, () => console.log(`fake-llm listening on ${port}`));
