import { RecommendationTracker } from '../src/services/recommendation-tracker';
import { config } from '../src/config';

async function run() {
  const tracker = new RecommendationTracker();
  const base = {
    symbol: 'MANUAL-BYPASS-' + Date.now(),
    direction: 'LONG' as const,
    entry_price: 1000,
    current_price: 1000,
    leverage: 2,
    strategy_type: 'UNITTEST'
  };

  try {
    const id1 = await tracker.addRecommendation(base);
    console.log('[manual] first ok id=', id1);
    let ok = false;
    try {
      await tracker.addRecommendation({ ...base, entry_price: base.entry_price * 1.02 });
    } catch (e: any) {
      if (e?.code === 'COOLDOWN_ACTIVE') {
        ok = true;
        console.log('[manual] second rejected by cooldown as expected');
      } else {
        console.error('[manual] second unexpected error', e);
      }
    }
    const id3 = await tracker.addRecommendation({ ...base, entry_price: base.entry_price * 1.03 }, { bypassCooldown: true });
    console.log('[manual] third ok with bypass id=', id3);

    // 新增回归：字符串 'false' 不应绕过
    let strFalseBlocked = false;
    try {
      await tracker.addRecommendation({ ...base, entry_price: base.entry_price * 1.04 }, { bypassCooldown: 'false' as any });
    } catch (e: any) {
      if (e?.code === 'COOLDOWN_ACTIVE') {
        strFalseBlocked = true;
        console.log('[manual] fourth blocked as expected with bypassCooldown="false" (string)');
      } else {
        console.error('[manual] fourth unexpected error', e);
      }
    }

    // 可选：字符串 'true' 也不应绕过（严格布尔判断）
    let strTrueBlocked = false;
    try {
      await tracker.addRecommendation({ ...base, entry_price: base.entry_price * 1.05 }, { bypassCooldown: 'true' as any });
    } catch (e: any) {
      if (e?.code === 'COOLDOWN_ACTIVE') {
        strTrueBlocked = true;
        console.log('[manual] fifth blocked as expected with bypassCooldown="true" (string)');
      } else {
        console.error('[manual] fifth unexpected error', e);
      }
    }

    if (!ok || !strFalseBlocked || !strTrueBlocked) process.exit(1);
    process.exit(0);
  } catch (e) {
    console.error('[manual] exception', e);
    process.exit(1);
  }
}

run();