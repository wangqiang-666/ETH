import { RecommendationDatabase } from "../services/recommendation-database";

async function main() {
  try {
    const arg = process.argv[2];
    const keep = Math.max(0, Math.floor(Number(arg ?? process.env.KEEP ?? 100)));

    const db = new RecommendationDatabase();
    await db.initialize();

    const result = await db.trimRecommendations(keep);
    console.log(JSON.stringify({ ok: true, keep, ...result }));
    process.exit(0);
  } catch (e: any) {
    console.error("Trim failed:", e?.message || e);
    process.exit(1);
  }
}

main();