import { GuiBackend } from "./backend";

export async function main(debug = false): Promise<void> {
  const backend = new GuiBackend();
  const server = await backend.start(debug);
  console.log(`Camoufox Manager: ${server.url}`);
  await new Promise<void>(() => undefined);
}
