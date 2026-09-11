import { json } from '@sveltejs/kit';
import { listModels } from '$lib/server/models';
export async function GET() {
  try {
    return json(await listModels());
  } catch (error) {
    return json({ error: String(error) }, { status: 400 });
  }
}
