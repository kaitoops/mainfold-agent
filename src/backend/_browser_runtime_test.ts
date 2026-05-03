/**
 * I-BROWSER-001 运行时验证脚本 v3 — 最终版
 * getBrowserStatus 直接返回 { launched, launchCount, isConnected }，无 data 包装
 */
import { navigate, screenshot, extractContent, getBrowserStatus, closeBrowser } from './tools/browser-automation.js';

async function runTest() {
  console.log('=== I-BROWSER-001 Runtime Test v3 ===\n');
  const URL = 'https://example.com';
  const results: boolean[] = [];

  // Test 1: getBrowserStatus (pre-launch) — 直接返回，无 data 包装
  console.log('[Test 1] getBrowserStatus() — pre-launch');
  const s1 = await getBrowserStatus();
  const t1 = s1.launched === false;
  results.push(t1);
  console.log(`  ${t1 ? 'PASS' : 'FAIL'}: launched=${s1.launched}, launchCount=${s1.launchCount}\n`);

  // Test 2: navigate
  console.log(`[Test 2] navigate("${URL}")`);
  const nav = await navigate(URL);
  const t2 = nav.success && nav.data?.title === 'Example Domain' && nav.data?.statusCode === 200;
  results.push(t2);
  console.log(`  ${t2 ? 'PASS' : 'FAIL'}: title="${nav.data?.title}", status=${nav.data?.statusCode}, ${nav.durationMs}ms\n`);

  // Test 3: getBrowserStatus (post-launch)
  console.log('[Test 3] getBrowserStatus() — post-launch');
  const s2 = await getBrowserStatus();
  const t3 = s2.launched === true && s2.isConnected === true;
  results.push(t3);
  console.log(`  ${t3 ? 'PASS' : 'FAIL'}: launched=${s2.launched}, isConnected=${s2.isConnected}\n`);

  // Test 4: screenshot
  console.log(`[Test 4] screenshot("${URL}")`);
  const ss = await screenshot(URL);
  const t4 = ss.success === true;
  results.push(t4);
  console.log(`  ${t4 ? 'PASS' : 'FAIL'}: path=${ss.data?.path}, ${ss.durationMs}ms\n`);

  // Test 5: extractContent
  console.log(`[Test 5] extractContent("${URL}")`);
  const ext = await extractContent(URL);
  const t5 = ext.success && (ext.data?.content?.includes('Example Domain') ?? false);
  results.push(t5);
  console.log(`  ${t5 ? 'PASS' : 'FAIL'}: content length=${ext.data?.content?.length}\n`);

  // Cleanup
  await closeBrowser();
  console.log('[Cleanup] Browser closed');

  // Summary
  const passed = results.filter(Boolean).length;
  console.log(`\n=== SUMMARY: ${passed}/${results.length} passed ===`);
  process.exit(passed === results.length ? 0 : 1);
}

runTest().catch(err => { console.error('FATAL:', err); process.exit(1); });
