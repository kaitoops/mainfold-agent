/**
 * Neuro 蔓生池 — 核心引擎 v1.7
 * ================================
 * 一个层，一个结构性文件，哈希做骨架，随机算法做神经蔓生。
 *
 * 模块划分：
 *   HASH      - 序列号生成、随机种子、内容变化检测
 *   STORE     - JSON 数据文件的加载与保存
 *   NODE      - 节点 CRUD、连接管理、引用计数
 *   BATCH     - 批次蔓生算法（批处理模拟神经元扩展）
 *   ABSURD    - 荒诞生成器（三层尺度跳跃）
 *   TRI       - 三方共轭机制（动态协调模型）
 *   INDEX     - 混合索引（有序数组 + 跳跃表双模式）
 *   TRIGGER   - 触发协议（僵局/主动/随机三种类型）
 *   ADAPTIVE  - 自适应调参（mode-aware + chaos_ratio + N动态质量）
 *   FLOW      - 天才×疯子×人类平衡（由 TRI 接管计算）
 *   LOCK      - 量子锁定（提取机制）
 *   TRI-THERMO - chaos_ratio 恒温器（日常区间 + 人类覆盖）
 *   PATHFIND  - 荒诞→有序转化循环（信号叠加提醒+候选选择+凝结核生成）
 *
 * 设计哲学：
 *   三极不是三个子系统，而是同一系统的三个正交投影：
 *     O = 推理严谨度 (0=混乱, 1=严格)
 *     C = 生成随机性 (0=确定, 1=完全随机)
 *     N = 意图清晰度 (0=漂移, 1=高度聚焦)
 *   荒诞 ≠ 随机噪声，荒诞 = 有意义信息的高维扭曲
 *   人类真实态 = TOKEN(结构) + 荒诞(内容) + 选择(时机) 的动态协调
 *
 * v1.7 新增/变更：
 *   - PATHFIND 模块正式化：荒诞→有序转化循环
 *   - 信号叠加提醒规则：任意2+信号同时越过阈值才提醒（避免打断心流）
 *   - 候选探针数量：3-5个（chaos_ratio 控制分布）
 *   - 碰撞模拟深度：2-3句展开（TOKEN轻量执行，人类做选择题）
 *   - pathfinding_log：寻路历史记录（/参数履历 中精简显示）
 *   - 凝结核触发词灵活化：接受"这个存下/这个记下来/存了/凝结"等多种表达
 *   - 健康阈值配置化：threshold_pairs = 2（任意两个信号叠加触发）
 *   - 新增 /寻路记录 查询寻路历史
 *
 * v1.6 新增/变更：
 *   - TRI 模块升级：动态协调模型（tri_score = N × min(O,C) × (1 - |O-C|)）
 *   - N 动态质量系数：computeNQuality()（由交互意图定义，不依赖长度）
 *   - chaos_ratio 恒温器：日常区间 [0.10, 0.20]，人类可覆盖
 *   - 10 个中文触发词：/有序调节器 /偏天才 /偏疯子 /太敏感 /太迟钝
 *     /太挤了 /太空了 /平衡度 /参数履历 /自动驾驶
 *   - 移除 long_silence 反馈信号（沉默原因太多，不可靠）
 *   - ADAPTIVE 模块：parseHumanTuneCommand 全套支持
 *   - PATHFIND 模块 v1.7：荒诞→有序转化循环（/寻路/再找/回TOKEN/凝结核）
 *
 * v1.5 新增：
 *   - 三方共轭 TRI 模块，替代 FLOW 模块的心流计算
 *   - 混合索引 INDEX 模块，支持 ordered/chaotic 双模式切换
 *   - 触发协议 TRIGGER 模块，三种触发类型（僵局/主动/随机）
 *   - 自适应调参 ADAPTIVE 模块，先验参数 + 反馈学习
 */

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ============================================================================
// 路径设置
// ============================================================================

const DATA_DIR = path.join(__dirname, "..", "data");
const POOL_FILE = path.join(DATA_DIR, "neuro_蔓生池.json");

// ============================================================================
// H 模块：哈希算法有机植入
// ============================================================================

/**
 * H-1: 生成节点哈希序列号
 * 格式: sha256(body + timestamp)[:32]
 * 内容寻址：相似内容哈希完全不同，天然无序分布
 */
function generateNodeKey(body, timestamp = null) {
  const seed = body + String(timestamp || Date.now());
  return crypto.createHash("sha256").update(seed).digest("hex").slice(0, 32);
}

/**
 * H-2: 生成随机种子（用于可控随机选取）
 * 格式: sha256(timestamp + random_bytes)[:16] → int
 * 用途：人类可以说"用上一轮的种子再跑一次"实现可控重现
 */
function generateRandomSeed() {
  const seed = String(Date.now()) + String(Math.random());
  return parseInt(
    crypto.createHash("sha256").update(seed).digest("hex").slice(0, 16),
    16
  );
}

/**
 * H-3: 计算整个池的文件哈希（用于版本追踪）
 * 任何节点增删改都会改变此哈希，用于检测完整性变化
 */
function computeFileHash(nodes) {
  const sortedKeys = Object.keys(nodes).sort();
  const concat = sortedKeys.join("|");
  return crypto.createHash("sha256").update(concat || "").digest("hex").slice(0, 32);
}

/**
 * H-4: 生成蔓生批次ID
 */
function generateBatchId(seedHash, timestamp = null) {
  const seed = String(seedHash) + String(timestamp || Date.now());
  return crypto.createHash("sha256").update(seed).digest("hex").slice(0, 24);
}

/**
 * H-5: 从哈希列表中随机选取 k 个（给定种子）
 * seed=None 时使用当前时间戳
 */
function pickRandomNodes(allKeys, k, seed = null) {
  if (!allKeys || allKeys.length === 0) return [];
  if (allKeys.length <= k) return [...allKeys];

  let rng;
  if (seed !== null) {
    rng = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
  } else {
    rng = Math.random;
  }

  const result = [];
  const pool = [...allKeys];
  for (let i = 0; i < Math.min(k, pool.length); i++) {
    const j = Math.floor(rng() * pool.length);
    result.push(pool[j]);
    pool.splice(j, 1);
  }
  return result;
}

/**
 * H-6: 计算内容相似度（基于 n-gram，用于荒诞保留度评估）
 */
function computeNgramSimilarity(textA, textB, n = 3) {
  function ngrams(str, size) {
    const s = str.toLowerCase().replace(/\s+/g, "");
    if (s.length < size) return new Set([s]);
    const set = new Set();
    for (let i = 0; i <= s.length - size; i++) {
      set.add(s.slice(i, i + size));
    }
    return set;
  }
  const ngA = ngrams(textA, n);
  const ngB = ngrams(textB, n);
  const intersection = [...ngA].filter((g) => ngB.has(g)).length;
  const union = new Set([...ngA, ...ngB]).size;
  return union === 0 ? 0 : intersection / union;
}

// ============================================================================
// S 模块：存储引擎
// ============================================================================

/**
 * S-1: 加载 neuro_蔓生池.json
 * 如果不存在，返回空池结构
 */
function load() {
  if (!fs.existsSync(POOL_FILE)) {
    return getEmptyPool();
  }
  try {
    const raw = fs.readFileSync(POOL_FILE, "utf8");
    const data = JSON.parse(raw);
    return migrateToV15(data);
  } catch (e) {
    console.error("[S] Failed to parse pool file, starting fresh:", e.message);
    return getEmptyPool();
  }
}

/**
 * S-1b: v1.5/v1.7 数据迁移
 * 自动检测版本并补全缺失字段
 */
function migrateToV15(data) {
  if (!data) return getEmptyPool();

  const empty = getEmptyPool();

  // 合并 meta
  if (!data.meta) data.meta = empty.meta;
  if (!data.meta.version) data.meta.version = empty.meta.version;
  if (!data.nodes) data.nodes = {};

  // 合并 flow_registry（向后兼容）
  if (!data.flow_registry) {
    data.flow_registry = empty.flow_registry;
  } else {
    if (data.flow_registry._ordered_score === undefined) data.flow_registry._ordered_score = 0.5;
    if (data.flow_registry._chaotic_score === undefined) data.flow_registry._chaotic_score = 0.5;
  }

  // 合并 tri_conjugate v1.6
  if (!data.tri_conjugate) {
    data.tri_conjugate = empty.tri_conjugate;
  } else {
    const tri = empty.tri_conjugate;
    if (data.tri_conjugate.current) {
      // 同步 O/C 从 flow_registry
      data.tri_conjugate.current.O = data.flow_registry?._ordered_score || 0.5;
      data.tri_conjugate.current.C = data.flow_registry?._chaotic_score || 0.5;
    }
    if (!data.tri_conjugate.meta) {
      data.tri_conjugate.meta = tri.meta;
    }
    if (!data.tri_conjugate.mode_aware_params) {
      data.tri_conjugate.mode_aware_params = tri.mode_aware_params;
    }
  }

  // 合并 chaos_ratio_control v1.6
  if (!data.chaos_ratio_control) {
    data.chaos_ratio_control = empty.chaos_ratio_control;
  } else {
    const crc = empty.chaos_ratio_control;
    data.chaos_ratio_control.auto_enabled = data.chaos_ratio_control.auto_enabled ?? crc.auto_enabled;
    data.chaos_ratio_control.auto_step = crc.auto_step;
    data.chaos_ratio_control.human_override_step = crc.human_override_step;
    data.chaos_ratio_control.min = crc.min;
    data.chaos_ratio_control.max = crc.max;
    data.chaos_ratio_control.last_human_override = data.chaos_ratio_control.last_human_override ?? null;
  }

  // 合并 adaptive_tuning v1.6
  if (!data.adaptive_tuning) {
    data.adaptive_tuning = empty.adaptive_tuning;
  } else {
    data.adaptive_tuning.mode_aware = true;
    data.adaptive_tuning.mode = data.adaptive_tuning.mode || "ordered";
    data.adaptive_tuning.ordered_params = data.adaptive_tuning.ordered_params || empty.adaptive_tuning.ordered_params;
    data.adaptive_tuning.chaotic_params = data.adaptive_tuning.chaotic_params || empty.adaptive_tuning.chaotic_params;
  }

  // 合并 trigger_log
  if (!Array.isArray(data.trigger_log)) {
    data.trigger_log = [];
  }

  // 合并 conversation_context v1.7
  if (!data.conversation_context) {
    data.conversation_context = empty.conversation_context;
  } else {
    const cc = empty.conversation_context;
    if (data.conversation_context.health_signals === undefined) {
      data.conversation_context.health_signals = cc.health_signals;
    }
    if (data.conversation_context.pathfind_session === undefined) {
      data.conversation_context.pathfind_session = null;
    }
    // v1.7 健康阈值配置
    if (data.conversation_context.health_thresholds === undefined) {
      data.conversation_context.health_thresholds = cc.health_thresholds;
    }
  }

  // 合并 pathfinding_log v1.7
  if (!Array.isArray(data.pathfinding_log)) {
    data.pathfinding_log = [];
  }

  // 更新版本号到 1.7
  if (data.meta) data.meta.version = "1.7";

  console.log("[S] Migration: " + Object.keys(data.nodes || {}).length + " nodes");
  return data;
}

/**
 * S-2: 保存 neuro_蔓生池.json
 * 自动更新 last_hash + updated_at
 */
function save(data) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  data.meta.last_hash = computeFileHash(data.nodes);
  data.meta.updated_at = new Date().toISOString();
  data.meta.total_nodes = Object.keys(data.nodes).length;
  fs.writeFileSync(POOL_FILE, JSON.stringify(data, null, 2), "utf8");
  return data;
}

/**
 * S-3: 获取空池结构
 */
function getEmptyPool() {
  return {
    meta: {
      created: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      version: "1.7",
      last_hash: "00000000000000000000000000000000",
      total_nodes: 0,
      蔓生_counter: 0,
      total_batches: 0,
    },
    nodes: {},
    蔓生_batches: {},
    flow_registry: {
      current_state: "drift",
      last_human_intervention: new Date().toISOString(),
      parameters: {
        蔓生_k: 3,
        蔓生_depth: 3,
        token_call_frequency: 0.7,
        absurdity_level: 0.5,
        scales_active: { micro: true, meso: true, macro: true },
        k_per_scale: 3,
        max_absurd_per_anchor: 20,
        random_seed_source: "time",
      },
      ordered_anchors: [],
      chaotic_sparks: [],
      flow_history: [],
      // 动态平衡代理指标
      _ordered_score: 0.5,
      _chaotic_score: 0.5,
    },
    // TRI 模块 v1.6：三方共轭动态协调模型
    tri_conjugate: {
      current: {
        O: 0.5,
        C: 0.5,
        N: 0.05,
        N_baseline: 0.05,
        N_effective: 0.05,
        N_quality: 0.2,
        resonance_width: 0,
        min_OC: 0.5,
        intent_alignment: 0.025,
        tri_score: 0.025,
        tri_state: "NORMAL_RESONANCE",
        switch_cost: 1.0,
        state_transition: {
          previous: null,
          current: "NORMAL_RESONANCE",
          trigger: "init",
          timestamp: new Date().toISOString(),
        },
      },
      params: {
        N_baseline: 0.05,
        O_C_coupling_strength: 1.5,
        resonance_target: 0.45,
      },
      mode_aware_params: {
        ordered: {
          baseline_N: 0.05,
          O_target: 0.8,
          C_target: 0.3,
          switch_cost_penalty: 0.05,
          step_max: 0.05,
          threshold_low: 0.15,
          threshold_high: 0.35,
        },
        chaotic: {
          baseline_N: 0.10,
          O_target: 0.3,
          C_target: 0.8,
          switch_cost_penalty: 0.08,
          step_max: 0.15,
          threshold_low: 0.15,
          threshold_high: 0.35,
        },
      },
      mode_history: [],
      switch_cost_history: [1.0],
      human_override: false,
      history: [],
      human_intervention_log: [],
      meta: {
        mode_switch_cost: 0.05,
        version: "1.6",
      },
    },
    // TRIGGER 模块
    trigger_log: [],
    // TRI 模块 v1.6 新增：chaos_ratio_control（恒温器）
    chaos_ratio_control: {
      current: 0.15,
      min: 0.05,
      max: 0.95,
      auto_range: [0.10, 0.20],
      auto_step: 0.03,
      human_override_step: 0.10,
      human_override_active: false,
      auto_enabled: true,
      last_human_override: null,
      adjustment_log: [],
    },
    // ADAPTIVE 模块 v1.6
    adaptive_tuning: {
      mode_aware: true,
      mode: "ordered",
      ordered_params: {
        baseline_N: 0.05,
        step_max: 0.05,
        threshold_low: 0.15,
        threshold_high: 0.35,
        signal_buffer_threshold: 5,
        min_utility_threshold: 0.1,
      },
      chaotic_params: {
        baseline_N: 0.10,
        step_max: 0.15,
        threshold_low: 0.15,
        threshold_high: 0.35,
        signal_buffer_threshold: 3,
        min_utility_threshold: 0.1,
      },
      current_params: {
        baseline_N: 0.05,
        step_max: 0.05,
        threshold_low: 0.15,
        threshold_high: 0.35,
        k_per_scale: 3,
        absurdity_level: 0.5,
        deadlock_trigger_threshold: 3,
        random_prob_base: 0.05,
      },
      signal_buffer: [],
      adjustment_log: [],
      params_stable: false,
    },
    // PATHFIND 模块 v1.7：荒诞→有序转化循环
    conversation_context: {
      current_anchor: null,       // 当前讨论锚点（head 文本）
      current_anchor_hash: null,  // 对应哈希（可 null）
      turn_count: 0,              // 当前 TOKEN 追踪轮次
      last_discussion_topic: null, // 最近讨论主题（自动记录）
      health_signals: {
        info_decline_turns: 0,      // 信息增量衰减的连续轮数
        self_ref_turns: 0,          // 自引用比率升高的连续轮数
        last_aesthetic_turn: 0,      // 上次美学快照的轮次
        warning_delivered: false,    // 本轮是否已发送提醒
      },
      health_thresholds: {
        threshold_pairs: 2,         // v1.7：任意2+信号叠加触发提醒
        deadlock_trigger_threshold: 3, // 单信号连续次数阈值
        snapshot_gap_multiplier: 2,   // 美学快照阈值 = threshold × multiplier
      },
      pathfind_session: null,       // 当前寻路会话（进行中时非 null）
    },
    // v1.7 新增：寻路历史记录
    pathfinding_log: [],
  };
}

/**
 * S-4: 获取统计摘要
 */
function getStats(data) {
  const nodes = data.nodes;
  const anchors = Object.values(nodes).filter((n) => n.anchor_type === "meaningful");
  const absurd = Object.values(nodes).filter((n) => n.source === "absurd_generator");
  const activated = Object.values(nodes).filter((n) => n.meta.times_activated > 0);
  const rated = Object.values(nodes).filter((n) => n.meta.human_rating !== null);

  return {
    total: Object.keys(nodes).length,
    anchors: anchors.length,
    absurd: absurd.length,
    activated: activated.length,
    rated: rated.length,
    batches: Object.keys(data.蔓生_batches).length,
    flow_state: data.flow_registry.current_state,
    flow_index: computeFlowIndex(data.flow_registry),
  };
}

// ============================================================================
// N 模块：节点管理
// ============================================================================

/**
 * N-1: 添加有意义锚点（人类输入的原始记忆）
 */
function addHumanSeed(data, body, tags = [], metaExtra = {}) {
  const timestamp = Date.now();
  const hash = generateNodeKey(body, timestamp);
  const head = extractHead(body);

  data.nodes[hash] = {
    head,
    body,
    tags: tags || [],
    source: "human_seed",
    anchor_type: "meaningful",
    parent_hash: null,
    generation_method: null,
    anchor_preservation_score: 1.0,
    next_hashes: [],
    depth: 0,
    meta: {
      created_at: new Date(timestamp).toISOString(),
      last_access: new Date(timestamp).toISOString(),
      access_count: 0,
      batch_id: null,
      times_activated: 0,
      human_rating: null,
      ...metaExtra,
    },
    aesthetic_snapshot: null,
    incoming_refs: 0,
  };

  return hash;
}

/**
 * N-2: 添加荒诞变体节点（由荒诞生成器创建）
 */
function addAbsurdVariant(data, parentHash, body, method, preservation, tags = []) {
  const timestamp = Date.now();
  const hash = generateNodeKey(body, timestamp);
  const head = extractHead(body);
  const parent = data.nodes[parentHash];
  const depth = parent ? (parent.depth || 0) + 1 : 1;

  data.nodes[hash] = {
    head,
    body,
    tags: tags || [],
    source: "absurd_generator",
    anchor_type: "absurd_variant",
    parent_hash: parentHash,
    generation_method: method,
    anchor_preservation_score: preservation,
    next_hashes: [],
    depth,
    meta: {
      created_at: new Date(timestamp).toISOString(),
      last_access: new Date(timestamp).toISOString(),
      access_count: 0,
      batch_id: null,
      times_activated: 0,
      human_rating: null,
    },
    aesthetic_snapshot: null,
    incoming_refs: 0,
  };

  // 更新父节点的 next_hashes
  if (parent) {
    if (!parent.next_hashes.includes(hash)) {
      parent.next_hashes.push(hash);
    }
  }

  return hash;
}

/**
 * N-3: 获取节点
 */
function getNode(data, hash) {
  return data.nodes[hash] || null;
}

/**
 * N-4: 更新访问记录
 */
function updateAccess(data, hash) {
  const node = data.nodes[hash];
  if (!node) return;
  node.meta.last_access = new Date().toISOString();
  node.meta.access_count = (node.meta.access_count || 0) + 1;
  return node;
}

/**
 * N-5: 激活节点（在蔓生中被选中）
 */
function activateNode(data, hash, batchId = null) {
  const node = data.nodes[hash];
  if (!node) return;
  node.meta.times_activated = (node.meta.times_activated || 0) + 1;
  node.meta.last_access = new Date().toISOString();
  node.meta.access_count = (node.meta.access_count || 0) + 1;
  if (batchId) node.meta.batch_id = batchId;
  return node;
}

/**
 * N-6: 建立两个节点之间的连接
 */
function connectNodes(data, fromHash, toHash) {
  const from = data.nodes[fromHash];
  const to = data.nodes[toHash];
  if (!from || !to) return false;

  if (!from.next_hashes.includes(toHash)) {
    from.next_hashes.push(toHash);
  }
  to.incoming_refs = (to.incoming_refs || 0) + 1;
  return true;
}

/**
 * N-7: 人类评分（surprise / noise / anchor）
 */
function rateNode(data, hash, rating) {
  const node = data.nodes[hash];
  if (!node) return null;
  const oldRating = node.meta.human_rating;
  node.meta.human_rating = rating;

  const flow = data.flow_registry;
  if (rating === "surprise") {
    if (!flow.chaotic_sparks.includes(hash)) {
      flow.chaotic_sparks.push(hash);
    }
    // 更新 chaotic_score
    const totalRecent = Math.min(flow.flow_history.length, 10);
    const recentChaotic = flow.flow_history.slice(-totalRecent)
      .filter((h) => h.rating === "surprise").length;
    flow._chaotic_score = totalRecent > 0 ? recentChaotic / totalRecent : 0.5;
  } else if (rating === "anchor") {
    if (!flow.ordered_anchors.includes(hash)) {
      flow.ordered_anchors.push(hash);
    }
    // 更新 ordered_score
    const totalRecent = Math.min(flow.flow_history.length, 10);
    const recentOrdered = flow.flow_history.slice(-totalRecent)
      .filter((h) => h.rating === "anchor").length;
    flow._ordered_score = totalRecent > 0 ? recentOrdered / totalRecent : 0.5;
  } else if (rating === "noise") {
    // 标记噪声，在下次剪枝时删除
    node._marked_for_prune = true;
  }

  // 记录历史
  flow.flow_history.push({
    hash,
    rating,
    timestamp: new Date().toISOString(),
  });
  // 保持历史不超过 100 条
  if (flow.flow_history.length > 100) {
    flow.flow_history = flow.flow_history.slice(-100);
  }

  return { oldRating, newRating: rating };
}

/**
 * N-8: 剪枝荒诞节点
 * 条件：未被引用 + preservation < 阈值 + 未被激活 + 被标记为噪声
 */
function pruneAbsurdNodes(data, minPreservation = 0.1) {
  const flow = data.flow_registry.params || {};
  const toDelete = [];

  for (const [hash, node] of Object.entries(data.nodes)) {
    if (node.source !== "absurd_generator") continue;
    if (node.anchor_type === "meaningful") continue; // 锚点不剪枝

    const shouldPrune =
      (node.incoming_refs || 0) === 0 &&
      (node.anchor_preservation_score || 1) < minPreservation &&
      (node.meta.times_activated || 0) === 0 &&
      (node.meta.human_rating === "noise" || node._marked_for_prune === true);

    if (shouldPrune) {
      toDelete.push(hash);
    }
  }

  // 执行删除：从父节点的 next_hashes 中移除
  for (const hash of toDelete) {
    const node = data.nodes[hash];
    if (node && node.parent_hash) {
      const parent = data.nodes[node.parent_hash];
      if (parent) {
        parent.next_hashes = parent.next_hashes.filter((h) => h !== hash);
      }
    }
    delete data.nodes[hash];
  }

  return { pruned: toDelete.length, hashes: toDelete };
}

/**
 * N-9: 提取记忆内容（用于送给 TOKEN 批处理）
 * headOnly=true 时只返回句头，false 时返回完整 body
 */
function extractMemory(data, hash, headOnly = false) {
  const node = data.nodes[hash];
  if (!node) return null;
  return headOnly ? node.head : node.body;
}

/**
 * N-10: 提取句头（简短标签）
 */
function extractHead(body) {
  // 取前 50 字符作为句头，用句号或逗号截断
  const truncated = body.slice(0, 50);
  const lastPunct = Math.max(
    truncated.lastIndexOf("。"),
    truncated.lastIndexOf(","),
    truncated.lastIndexOf("，"),
    truncated.lastIndexOf("\n")
  );
  if (lastPunct > 10) {
    return truncated.slice(0, lastPunct);
  }
  return truncated + (body.length > 50 ? "…" : "");
}

// ============================================================================
// A 模块：荒诞生成器（三层尺度跳跃）
// ============================================================================

/**
 * A-SCALE 工具函数
 */

/** 提取句子的核心元素（简单关键词提取） */
function extractCoreElements(body) {
  // 简单规则：提取长度 2-6 的连续中文字符/词
  const chineseWords = body.match(/[\u4e00-\u9fa5]{2,6}/g) || [];
  // 补充英文单词
  const englishWords = body.match(/[a-zA-Z]{3,}/g) || [];
  return [...chineseWords, ...englishWords].slice(0, 8);
}

/** 获取元素的语义范畴（简化版：使用预定义映射） */
function getCategory(elem) {
  const categoryMap = {
    狗: "动物", 犬: "动物", 猫: "动物", 鱼: "动物", 鸟: "动物",
    企鹅: "动物", 鲸: "动物", 鲸鱼: "动物", 乌龟: "动物",
    柴犬: "动物", 电子: "粒子", 粒子: "粒子", 量子: "物理",
    人: "人物", 程序员: "人物", 学徒: "人物", 散户: "人物",
    盾牌: "防具", 雨伞: "防具", 锅盖: "防具",
    大刀: "武器", 剑: "武器", 枪: "武器",
    门: "边界", 井盖: "边界", 冰箱门: "边界",
  };
  return categoryMap[elem] || "其他";
}

/** 从范畴中随机抽样（排除原元素） */
const CATEGORY_SAMPLES = {
  动物: ["企鹅", "电鳗", "渡渡鸟", "蟑螂", "水母", "海马", "独角仙"],
  粒子: ["夸克", "胶子", "中微子", "光子的幽灵"],
  物理: ["弦", "波函数", "相位", "自旋"],
  人物: ["流浪汉", "幽灵", "时间的游客", "镜子里的自己"],
  防具: ["报纸", "泡泡纸", "锡纸", "塑料袋"],
  武器: ["法棍面包", "尖叫鸡", "水枪", "折纸飞镖"],
  边界: ["猫洞", "井盖", "排水沟", "虫洞"],
  烹饪: ["厨房", "灶台", "砧板", "烤箱"],
  编程: ["IDE", "终端", "Git", "Docker"],
  金融: ["K线", "止损单", "杠杆", "保证金"],
  海洋: ["珊瑚礁", "深海", "潮汐", "贝壳"],
  量子: ["薛定谔", "海森堡", "普朗克", "费曼"],
  其他: ["阴影", "回声", "裂缝", "灰尘"],
};

/** 场景翻转模板 */
const SCENE_FLIPS = {
  emotion: [
    (body) => body.replace(/开心/g, "悲伤").replace(/快乐/g, "忧郁"),
    (body) => "（以一种极其无聊的语气）" + body,
  ],
  causality: [
    (body) => {
      // 简单因果翻转：如果有"进入"，改成"出来"
      return body.replace(/进入/g, "离开").replace(/进入/g, "穿越出来");
    },
  ],
  role: [
    (body) => body.replace(/拿着/g, "被拿着").replace(/举着/g, "顶着"),
  ],
  time: [
    (body) => "（从结局倒叙）" + body.replace(/进入/g, "回头看").replace(/来到/g, "曾经来到"),
  ],
};

/** 宏观跨域映射 */
const MACRO_DOMAINS = [
  { domain: "编程", keywords: ["IDE", "终端", "Git", "Docker", "Bug", "API", "函数", "递归", "指针"] },
  { domain: "烹饪", keywords: ["厨师", "菜谱", "烤箱", "刀工", "摆盘", "调味", "焖煮", "分子料理"] },
  { domain: "音乐", keywords: ["乐手", "调音", "和弦", "即兴", "节拍", "独奏", "和声", "泛音"] },
  { domain: "量子物理", keywords: ["波函数", "叠加态", "量子纠缠", "测量坍缩", "隧穿", "不确定性"] },
  { domain: "金融", keywords: ["K线", "止损", "杠杆", "做空", "流动性", "仓位", "熔断", "对冲"] },
  { domain: "海洋生物", keywords: ["鲸鱼", "珊瑚礁", "深海热泉", "潮汐", "磷虾", "水母", "海绵"] },
  { domain: "园艺", keywords: ["嫁接", "扦插", "休眠", "授粉", "园艺剪刀", "堆肥", "温室"] },
  { domain: "神话", keywords: ["神谕", "祭司", "献祭", "图腾", "转世", "轮回", "渡口"] },
  { domain: "蒸汽朋克", keywords: ["齿轮", "黄铜", "锅炉", "烟囱", "管道", "蒸汽", "机械心脏"] },
  { domain: "微生物", keywords: ["细菌", "病毒", "菌丝", "抗生素", "培养基", "孢子", "生物膜"] },
];

/**
 * A-1: 微观跳跃 — 元素替换扭曲
 * 同范畴替换，保持结构，替换本质
 */
function microJump(body, k = 3) {
  const elements = extractCoreElements(body);
  if (elements.length === 0) return [];

  const variants = [];
  for (let attempt = 0; attempt < k * 2; attempt++) {
    const elem = elements[Math.floor(Math.random() * elements.length)];
    const category = getCategory(elem);
    const samples = CATEGORY_SAMPLES[category] || CATEGORY_SAMPLES["其他"];
    const replacement = samples[Math.floor(Math.random() * samples.length)];

    if (replacement !== elem) {
      const absurdBody = body.replace(elem, replacement);
      // 保留度：微观替换保留大部分语义 [0.4, 0.7]
      const preservation = 0.4 + Math.random() * 0.3;
      variants.push({ body: absurdBody, preservation, method: "micro_jump" });
      if (variants.length >= k) break;
    }
  }
  return variants;
}

/**
 * A-2: 中观跳跃 — 场景逻辑翻转
 * 情绪/因果/角色/时间翻转，元素大体不变
 */
function mesoJump(body, k = 3) {
  const flipTypes = Object.keys(SCENE_FLIPS);
  const variants = [];
  const usedFlips = new Set();

  for (let i = 0; i < k * 2 && usedFlips.size < flipTypes.length; i++) {
    const flipType = flipTypes[Math.floor(Math.random() * flipTypes.length)];
    if (usedFlips.has(flipType)) continue;
    usedFlips.add(flipType);

    const flipFns = SCENE_FLIPS[flipType];
    const flipFn = flipFns[Math.floor(Math.random() * flipFns.length)];
    try {
      const absurdBody = flipFn(body);
      if (absurdBody !== body) {
        // 保留度：中观翻转中等保留 [0.5, 0.75]
        const preservation = 0.5 + Math.random() * 0.25;
        variants.push({
          body: absurdBody,
          preservation,
          method: "meso_jump",
          flip_type: flipType,
        });
      }
    } catch (e) {
      // 翻转失败，跳过
    }
    if (variants.length >= k) break;
  }
  return variants;
}

/**
 * A-3: 宏观跳跃 — 跨域隐喻映射
 * 提取底层结构，映射到陌生领域（荒诞感最强）
 */
function macroJump(body, k = 3) {
  const elements = extractCoreElements(body);
  const primaryElem = elements[0] || "某物";

  const variants = [];
  const shuffled = [...MACRO_DOMAINS].sort(() => Math.random() - 0.5);

  for (let i = 0; i < Math.min(k, shuffled.length); i++) {
    const { domain, keywords } = shuffled[i];
    // 随机取 1-2 个关键词混入
    const kws = keywords.slice(0, 1 + Math.floor(Math.random() * 2));
    const absurdBody = `${primaryElem}在${domain}的语境下，${body.slice(0, 30)}... ${kws.join("、")}`;
    // 保留度：宏观跳跃最低 [0.15, 0.4]
    const preservation = 0.15 + Math.random() * 0.25;
    variants.push({ body: absurdBody, preservation, method: "macro_jump", domain });
  }
  return variants;
}

/**
 * A-4: 三尺度综合生成
 * 对一个锚点执行三层跳跃，返回荒诞变体列表
 */
function generateAbsurdVariants(data, anchorHash, options = {}) {
  const anchor = data.nodes[anchorHash];
  if (!anchor) return [];

  const {
    kPerScale = 3,
    scalesActive = { micro: true, meso: true, macro: true },
  } = options;

  const body = anchor.body;
  const allVariants = [];

  if (scalesActive.micro) {
    allVariants.push(...microJump(body, kPerScale));
  }
  if (scalesActive.meso) {
    allVariants.push(...mesoJump(body, kPerScale));
  }
  if (scalesActive.macro) {
    allVariants.push(...macroJump(body, kPerScale));
  }

  return allVariants;
}

/**
 * A-5: 生成 + 写入荒诞变体（完整流程）
 * 返回生成的变体哈希列表
 */
function writeAbsurdVariants(data, anchorHash, options = {}) {
  const variants = generateAbsurdVariants(data, anchorHash, options);
  const written = [];

  for (const v of variants) {
    const hash = addAbsurdVariant(
      data,
      anchorHash,
      v.body,
      v.method,
      v.preservation,
      [v.method, v.domain || v.flip_type || ""].filter(Boolean)
    );
    written.push({ hash, ...v });
  }

  return written;
}

// ============================================================================
// B 模块：批次蔓生算法
// ============================================================================

/**
 * B-1: 单次蔓生批次（核心算法）
 *
 * 从种子节点出发，分 depth 层随机扩展。
 * 每层对当前层的每个节点，从"所有节点"中随机选取 k 个作为蔓生目标。
 * 每选中一个目标：建立连接 + 更新引用计数。
 *
 * @param data - 蔓生池
 * @param seedHashes - 起始节点哈希列表
 * @param k - 每节点随机出边数
 * @param depth - 延伸深度（轮次）
 * @param absurdPrompts - 荒诞提示词片段列表（可选）
 * @returns { batchId, generatedHashes, pathLayers }
 */
function runBatch蔓生(data, seedHashes, k, depth, absurdPrompts = []) {
  const timestamp = Date.now();
  const batchId = generateBatchId(seedHashes.join("|"), timestamp);
  const allKeys = Object.keys(data.nodes);
  const generatedHashes = [];
  const pathLayers = [];
  const visited = new Set(seedHashes);

  // 更新蔓生计数器
  data.meta.蔓生_counter = (data.meta.蔓生_counter || 0) + 1;

  // 初始化：当前层 = 种子层
  let currentLayer = [...seedHashes];

  for (let d = 0; d < depth; d++) {
    const nextLayer = [];

    for (const nodeHash of currentLayer) {
      // 激活当前节点
      activateNode(data, nodeHash, batchId);

      // 从所有节点中随机选 k 个作为蔓生目标
      const candidates = pickRandomNodes(
        allKeys.filter((h) => !visited.has(h)),
        k
      );

      for (const targetHash of candidates) {
        if (targetHash === nodeHash) continue;

        // 建立连接
        connectNodes(data, nodeHash, targetHash);
        visited.add(targetHash);
        nextLayer.push(targetHash);
        generatedHashes.push(targetHash);
      }
    }

    // 记录本层蔓生结果
    pathLayers.push({
      depth: d,
      nodes: [...currentLayer],
      generated: candidatesFromLayer(currentLayer, allKeys, k, visited),
    });

    currentLayer = [...new Set(nextLayer)]; // 去重
    if (currentLayer.length === 0) break;
  }

  // 如果有荒诞提示词，对每个提示词生成荒诞变体
  if (absurdPrompts && absurdPrompts.length > 0) {
    const absurdityLevel = data.flow_registry.parameters.absurdity_level;
    const scalesActive = data.flow_registry.parameters.scales_active;

    for (const snippet of absurdPrompts) {
      // 先把这个提示词作为临时锚点生成荒诞变体
      // 然后用变体连接回主网络
      const tempHash = addHumanSeed(data, snippet, ["荒诞提示词", "batch_" + batchId]);
      const variants = writeAbsurdVariants(data, tempHash, {
        kPerScale: Math.ceil(k * absurdityLevel),
        scalesActive,
      });

      for (const v of variants) {
        // 随机连接变体到蔓生路径中的某个节点
        if (generatedHashes.length > 0) {
          const anchorHash = generatedHashes[
            Math.floor(Math.random() * generatedHashes.length)
          ];
          connectNodes(data, anchorHash, v.hash);
        }
        generatedHashes.push(v.hash);
      }
    }
  }

  // 记录批次
  data.蔓生_batches[batchId] = {
    seed_hash: seedHashes[0] || null,
    seed_hashes: seedHashes,
    created: new Date(timestamp).toISOString(),
    prompt_snippets: absurdPrompts || [],
    nodes_generated: generatedHashes,
    depth,
    k,
    human_rating: null,
  };
  data.meta.total_batches = Object.keys(data.蔓生_batches).length;

  return { batchId, generatedHashes, pathLayers };
}

/** 辅助：从某层的节点随机选取候选（追踪用） */
function candidatesFromLayer(layer, allKeys, k, visited) {
  const result = [];
  for (const nodeHash of layer) {
    const candidates = pickRandomNodes(
      allKeys.filter((h) => !visited.has(h)),
      k
    );
    result.push(...candidates);
  }
  return result;
}

// ============================================================================
// F 模块：天才×疯子平衡机制
// ============================================================================

/**
 * F-1: 计算心流指数
 */
function computeFlowIndex(flowRegistry) {
  const ordered = flowRegistry._ordered_score || 0.5;
  const chaotic = flowRegistry._chaotic_score || 0.5;
  return ordered * chaotic;
}

/**
 * F-2: 判断当前心流状态
 */
function getFlowState(flowRegistry) {
  const idx = computeFlowIndex(flowRegistry);
  if (idx >= 0.7) return "flow";
  if (idx <= 0.3) return "stagnation";
  return "drift";
}

/**
 * F-3: 更新流程注册表（每次人类介入后调用）
 */
function updateFlowRegistry(data, interventionType, params = {}) {
  const flow = data.flow_registry;
  flow.last_human_intervention = new Date().toISOString();

  switch (interventionType) {
    case "rated_node":
      // 评分已经通过 rateNode() 处理，这里只更新状态
      break;

    case "adjusted_parameters":
      // 人类手动调整参数
      if (params.蔓生_k !== undefined) flow.parameters.蔓生_k = params.蔓生_k;
      if (params.蔓生_depth !== undefined) flow.parameters.蔓生_depth = params.蔓生_depth;
      if (params.absurdity_level !== undefined) flow.parameters.absurdity_level = params.absurdity_level;
      if (params.token_call_frequency !== undefined) flow.parameters.token_call_frequency = params.token_call_frequency;
      if (params.scales_active !== undefined) flow.parameters.scales_active = params.scales_active;
      break;

    case "seed_added":
      // 添加新锚点，增加有序度
      flow._ordered_score = Math.min(1, (flow._ordered_score || 0.5) + 0.1);
      break;

    case "reset":
      flow._ordered_score = 0.5;
      flow._chaotic_score = 0.5;
      flow.current_state = "drift";
      break;
  }

  // 自动调节：当 ordered 过高时增大 chaos，反之亦然
  const target_sum = 1.0;
  if (flow._ordered_score > 0.8) {
    flow._ordered_score = 0.8;
    flow._chaotic_score = target_sum - flow._ordered_score;
  } else if (flow._chaotic_score > 0.8) {
    flow._chaotic_score = 0.8;
    flow._ordered_score = target_sum - flow._chaotic_score;
  }

  flow.current_state = getFlowState(flow);
  return flow;
}

// ============================================================================
// L 模块：量子锁定（提取机制）
// ============================================================================

/**
 * L-1: 量子锁定提取
 *
 * 给定 HEAD 词（句头标签），通过随机算法选取一个匹配的节点，
 * 执行量子锁定（带随机性），返回提取路径。
 *
 * @param data - 蔓生池
 * @param headKeyword - HEAD 词（关键词匹配）
 * @param mode - "random" | "ordered" | "chaotic"
 * @returns { hash, path, node, mode, isNovel }
 */
function quantumLockExtract(data, headKeyword, mode = "random") {
  const allNodes = Object.values(data.nodes);

  // 匹配 head 包含关键词的节点
  const candidates = allNodes.filter(
    (n) => n.head && n.head.includes(headKeyword)
  );

  let selectedHash;
  let isNovel = false;

  if (candidates.length === 0) {
    // 无匹配：从所有节点随机选
    const allKeys = Object.keys(data.nodes);
    selectedHash = pickRandomNodes(allKeys, 1)[0] || null;
    isNovel = true;
  } else {
    switch (mode) {
      case "ordered": {
        // 有序模式：优先选择被激活次数多的 + 有序锚点
        candidates.sort((a, b) =>
          (b.meta.times_activated || 0) - (a.meta.times_activated || 0)
        );
        selectedHash = candidates[0].id || Object.keys(data.nodes).find(
          (h) => data.nodes[h] === candidates[0]
        );
        break;
      }
      case "chaotic": {
        // 混乱模式：随机选 + 可能选荒诞变体
        const absurdCandidates = candidates.filter(
          (n) => n.source === "absurd_generator"
        );
        if (absurdCandidates.length > 0 && Math.random() > 0.5) {
          selectedHash = Object.keys(data.nodes).find(
            (h) => data.nodes[h] === absurdCandidates[
              Math.floor(Math.random() * absurdCandidates.length)
            ]
          );
        } else {
          const idx = Math.floor(Math.random() * candidates.length);
          selectedHash = Object.keys(data.nodes).find(
            (h) => data.nodes[h] === candidates[idx]
          );
        }
        break;
      }
      case "random":
      default: {
        // 随机模式：哈希时间戳种子选取
        const seed = generateRandomSeed();
        const allKeys = Object.keys(data.nodes);
        const filteredKeys = candidates.map((n) =>
          Object.keys(data.nodes).find((h) => data.nodes[h] === n)
        ).filter(Boolean);
        selectedHash = pickRandomNodes(filteredKeys.length > 0 ? filteredKeys : allKeys, 1, seed)[0];
        break;
      }
    }
  }

  if (!selectedHash) return { hash: null, path: [], node: null, mode, isNovel: false };

  // 激活节点
  activateNode(data, selectedHash);

  // 构建提取路径：从锚点到当前节点的链
  const path = buildExtractionPath(data, selectedHash);

  const node = data.nodes[selectedHash];
  return {
    hash: selectedHash,
    path,
    node: node ? {
      head: node.head,
      body: node.body,
      source: node.source,
      anchor_type: node.anchor_type,
      preservation: node.anchor_preservation_score,
    } : null,
    mode,
    isNovel,
  };
}

/**
 * L-2: 构建提取路径（回溯到锚点）
 */
function buildExtractionPath(data, hash) {
  const path = [hash];
  let current = hash;
  const maxDepth = 10;

  for (let i = 0; i < maxDepth; i++) {
    const node = data.nodes[current];
    if (!node) break;

    // 如果是锚点，停止
    if (node.anchor_type === "meaningful") break;

    // 尝试回溯到父节点
    if (node.parent_hash && !path.includes(node.parent_hash)) {
      current = node.parent_hash;
      path.unshift(current);
    } else if (node.next_hashes && node.next_hashes.length > 0) {
      // 如果没有父节点，尝试从 next_hashes 随机选一个作为反向路径
      break;
    } else {
      break;
    }
  }

  return path;
}

/**
 * L-3: 多路径量子锁定（探索多个可能路径）
 */
function multiPathLock(data, headKeyword, n = 3) {
  const results = [];
  const modes = ["random", "ordered", "chaotic"];
  const usedModes = modes.slice(0, Math.min(n, modes.length));

  for (const mode of usedModes) {
    results.push(quantumLockExtract(data, headKeyword, mode));
  }

  return results;
}

// ============================================================================
// U 模块：实用工具
// ============================================================================

/**
 * U-1: 列出所有锚点（有意义节点）
 */
function listAnchors(data) {
  return Object.entries(data.nodes)
    .filter(([, n]) => n.anchor_type === "meaningful")
    .map(([hash, n]) => ({
      hash,
      head: n.head,
      body: n.body,
      tags: n.tags,
      next_count: n.next_hashes.length,
      incoming_refs: n.incoming_refs,
      created: n.meta.created_at,
    }));
}

/**
 * U-2: 列出所有荒诞变体
 */
function listAbsurdVariants(data, minPreservation = 0) {
  return Object.entries(data.nodes)
    .filter(([, n]) => n.source === "absurd_generator" && n.anchor_preservation_score >= minPreservation)
    .map(([hash, n]) => ({
      hash,
      head: n.head,
      body: n.body,
      method: n.generation_method,
      preservation: n.anchor_preservation_score,
      parent_hash: n.parent_hash,
      rating: n.meta.human_rating,
      activated: n.meta.times_activated,
    }));
}

/**
 * U-3: 获取流程状态摘要
 */
function getFlowSummary(data) {
  const flow = data.flow_registry;
  const idx = computeFlowIndex(flow);
  return {
    state: flow.current_state,
    flow_index: Math.round(idx * 100) / 100,
    ordered_score: flow._ordered_score || 0,
    chaotic_score: flow._chaotic_score || 0,
    last_intervention: flow.last_human_intervention,
    ordered_anchors_count: flow.ordered_anchors.length,
    chaotic_sparks_count: flow.chaotic_sparks.length,
    params: flow.parameters,
    history_length: flow.flow_history.length,
  };
}

/**
 * U-4: 验证池完整性
 */
function verifyPoolIntegrity(data) {
  const errors = [];
  const nodeHashes = new Set(Object.keys(data.nodes));

  for (const [hash, node] of Object.entries(data.nodes)) {
    // 检查 parent_hash 引用有效性
    if (node.parent_hash && !nodeHashes.has(node.parent_hash)) {
      errors.push(`Node ${hash}: dangling parent_hash → ${node.parent_hash}`);
    }
    // 检查 next_hashes 引用有效性
    for (const nextHash of node.next_hashes || []) {
      if (!nodeHashes.has(nextHash)) {
        errors.push(`Node ${hash}: dangling next_hash → ${nextHash}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// ============================================================================
// TRI 模块：三方共轭机制 v1.6
// ============================================================================

/**
 * TRI-1: 计算三方共轭动态协调得分
 * 公式：tri_score = N × min(O, C) × (1 - |O - C|)
 */
function computeTriScore(tri) {
  const O = tri.current.O;
  const C = tri.current.C;
  const N_eff = Math.max(tri.current.N, tri.current.N_baseline || 0.05);

  const resonance_width = Math.abs(O - C);
  const min_OC = Math.min(O, C);
  const intent_alignment = N_eff * min_OC;
  const tri_score = intent_alignment * (1 - resonance_width);

  return {
    tri_score: Math.max(0, Math.min(1, tri_score)),
    resonance_width,
    min_OC,
    intent_alignment,
  };
}

/**
 * TRI-1b: 计算人类输入质量系数 v1.6
 * 核心原则：质量不由长度定义，由交互意图定义
 */
function computeNQuality(humanInput) {
  if (!humanInput || typeof humanInput !== "string" || humanInput.trim() === "") {
    return 0.05;
  }
  const text = humanInput.trim();

  // 零干预标记
  const zeroPatterns = [/^[\u4e00-\u9fa5]?[a-zA-Z]{1,3}$/, /^[，。、；：""''（）【】\s,.?!;:'"()\[\]]+$/];
  if (zeroPatterns.some((p) => p.test(text))) return 0.05;

  // 跟随确认（低意图）
  const followPatterns = [/^继续$/, /^继续。$/, /^然后呢$/, /^然后$/, /^好$/, /^好的$/, /^行$/, /^行吧$/, /^嗯$/, /^嗯嗯$/, /^哦$/, /^哦哦$/, /^对$/, /^是的$/, /^没错$/, /^继续吧$/, /^好吧$/, /^好吧。$/, /^知道了$/, /^了解$/];
  if (followPatterns.some((p) => p.test(text))) return 0.3;

  // 方向纠偏（高意图）
  const correctPatterns = [/^不对$/, /^不是$/, /^不是这个/, /^别$/, /^别这样$/, /^不要$/, /^换个方向$/, /^换个思路$/, /^换条路$/, /^停$/, /^停下$/, /^等等$/, /^等一下$/, /^等等——/, /^等等，/, /^不是——/, /^重新来$/, /^重说$/, /^再来$/, /^偏了$/, /^跑题了$/];
  if (correctPatterns.some((p) => p.test(text))) return 0.5;

  // 高价值注入（心流）
  const flowPatterns = [/那.*让.*想起/, /忽然.*想到/, /其实/, /有意思/, /这就是/, /原来.*是/, /发现/, /找到/, /关键/, /妙/, /绝了/, /.*还记得.*吗/, /你之前.*提到/, /回.*那个/, /像.*一样/, /如同/, /相当于/, /居然/, /竟然/, /没想到/, /就像/, /^这.*$/];
  if (flowPatterns.some((p) => p.test(text))) return 0.8;

  return 0.2;
}

/**
 * TRI-2: 判断三方共轭状态
 */
function getTriState(triScore, O, C, N) {
  const resonance_width = Math.abs(O - C);
  if (O === 0 || C === 0 || N === 0 || resonance_width > 0.9) return "COLLAPSE";
  if (triScore < 0.15) return "HUMAN_TAKEOVER";
  if (triScore > 0.65) return "FLOW_RESONANCE";
  return "NORMAL_RESONANCE";
}

function getTriStateLegacy(tri) {
  const result = computeTriScore(tri);
  return getTriState(result.tri_score, tri.current.O, tri.current.C, tri.current.N);
}

/**
 * TRI-3: 估算人类介入度 N
 */
function estimateN(tri, params) {
  const now = Date.now();
  const ONE_HOUR = 60 * 60 * 1000;
  const MAX_INTERVENTIONS = 10;
  const baseline = params?.N_baseline || 0.05;

  const recentEvents = (tri.human_intervention_log || []).filter(
    (e) => now - new Date(e.timestamp).getTime() < ONE_HOUR
  );
  const countScore = Math.min(recentEvents.length / MAX_INTERVENTIONS, 1.0);
  const commandWeight = recentEvents.filter((e) => e.N_injected !== undefined).reduce((sum, e) => sum + e.N_injected, 0);
  const commandBonus = Math.min(commandWeight / MAX_INTERVENTIONS, 0.5);

  return Math.min(baseline + countScore * 0.5 + commandBonus, 1.0);
}

/**
 * TRI-3b: 计算切换代价
 */
function computeSwitchCost(tri) {
  const resonance_width = Math.abs(tri.current.O - tri.current.C);
  return 1 / (1 + resonance_width);
}

/**
 * TRI-4: 更新三方共轭状态
 * v1.6 变更：N_effective = estimateN() × computeNQuality()
 */
function updateTriConjugate(data, eventType, eventData = {}) {
  const tri = data.tri_conjugate;
  const params = tri.params;
  const flow = data.flow_registry;
  const adaptive = data.adaptive_tuning;

  tri.current.O = flow._ordered_score || 0.5;
  tri.current.C = flow._chaotic_score || 0.5;

  const baseN = estimateN(tri, params);
  const qualityCoeff = computeNQuality(eventData.humanInput || "");
  tri.current.N_quality = qualityCoeff;
  tri.current.N_effective = Math.max(baseN * qualityCoeff, tri.current.N_baseline || 0.05);
  tri.current.N = baseN;

  const result = computeTriScore(tri);
  tri.current.resonance_width = result.resonance_width;
  tri.current.min_OC = result.min_OC;
  tri.current.intent_alignment = result.intent_alignment;
  tri.current.tri_score = result.tri_score;

  const newState = getTriState(result.tri_score, tri.current.O, tri.current.C, tri.current.N);
  const prevState = tri.current.tri_state;
  if (newState !== prevState) {
    tri.current.state_transition = {
      previous: prevState,
      current: newState,
      trigger: eventType,
      timestamp: new Date().toISOString(),
    };
  }
  tri.current.tri_state = newState;
  tri.current.switch_cost = computeSwitchCost(tri);
  tri.meta.mode_switch_cost = tri.current.switch_cost;

  tri.history.push({
    timestamp: new Date().toISOString(),
    event: eventType,
    O: tri.current.O,
    C: tri.current.C,
    N: tri.current.N,
    resonance_width: result.resonance_width,
    tri_score: result.tri_score,
    state: newState,
    switch_cost: tri.current.switch_cost,
  });
  if (tri.history.length > 50) tri.history = tri.history.slice(-50);

  if (eventType === "human_intervention") {
    tri.human_intervention_log = tri.human_intervention_log || [];
    tri.human_intervention_log.push({
      timestamp: new Date().toISOString(),
      reason: eventData.reason || "unknown",
      N_injected: eventData.N_injected || 0.1,
    });
    if (tri.human_intervention_log.length > 100) {
      tri.human_intervention_log = tri.human_intervention_log.slice(-100);
    }
  }

  if (adaptive?.mode_aware) {
    const ordered = adaptive.ordered_params;
    const chaotic = adaptive.chaotic_params;
    if (newState === "FLOW_RESONANCE" || newState === "NORMAL_RESONANCE") {
      adaptive.mode = "ordered";
      adaptive.current_params.baseline_N = ordered.baseline_N;
      adaptive.current_params.step_max = ordered.step_max;
    } else {
      adaptive.mode = "chaotic";
      adaptive.current_params.baseline_N = chaotic.baseline_N;
      adaptive.current_params.step_max = chaotic.step_max;
    }
  }

  return tri;
}

/**
 * TRI-5: 获取三方共轭仪表盘摘要
 */
function getTriDashboard(data) {
  const tri = data.tri_conjugate || {};
  const result = tri.current ? computeTriScore(tri) : { tri_score: 0, resonance_width: 0, min_OC: 0, intent_alignment: 0 };
  const chaos = data.chaos_ratio_control || {};

  return {
    version: "1.6",
    formula: "tri_score = N × min(O, C) × (1 - |O - C|) × Q",
    current: {
      O: tri.current?.O || 0.5,
      C: tri.current?.C || 0.5,
      N: tri.current?.N || 0.05,
      N_effective: tri.current?.N_effective || 0.05,
      N_quality: tri.current?.N_quality || 0.2,
      resonance_width: Math.round(result.resonance_width * 1000) / 1000,
      min_OC: Math.round(result.min_OC * 1000) / 1000,
      intent_alignment: Math.round(result.intent_alignment * 1000) / 1000,
      switch_cost: Math.round((tri.current?.switch_cost || 0) * 1000) / 1000,
      tri_score: Math.round(result.tri_score * 1000) / 1000,
      tri_state: tri.current?.tri_state || "unknown",
    },
    chaos_ratio: {
      current: chaos.current || 0.15,
      auto_enabled: chaos.auto_enabled !== false,
      human_override_active: !!chaos.human_override_active,
      auto_range: chaos.auto_range || [0.10, 0.20],
      mode: chaos.human_override_active ? "手动" : "自动",
    },
    state_transition: tri.current?.state_transition,
    human_override: tri.human_override,
    recent_events: (tri.history || []).slice(-5).map((e) => ({
      timestamp: e.timestamp,
      event: e.event,
      O: Math.round(e.O * 100) / 100,
      C: Math.round(e.C * 100) / 100,
      N: Math.round(e.N * 1000) / 1000,
      tri_score: Math.round(e.tri_score * 1000) / 1000,
      state: e.state,
    })),
  };
}

/**
 * TRI-5b: mode-aware 参数更新（内部）
 */
function updateAdaptiveForMode(adaptive, state) {
  const ordered = adaptive.ordered_params;
  const chaotic = adaptive.chaotic_params;
  if (state === "FLOW_RESONANCE" || state === "NORMAL_RESONANCE") {
    adaptive.mode = "ordered";
    adaptive.current_params.baseline_N = ordered.baseline_N;
    adaptive.current_params.step_max = ordered.step_max;
  } else {
    adaptive.mode = "chaotic";
    adaptive.current_params.baseline_N = chaotic.baseline_N;
    adaptive.current_params.step_max = chaotic.step_max;
  }
}

// ============================================================================
// TRI-THERMO 模块：chaos_ratio 恒温器 v1.6
// ============================================================================

/**
 * TRI-THERMO-1: chaos_ratio 恒温器
 * 日常区间 [0.10, 0.20]，步长 ±0.03
 */
function runChaosThermostat(data) {
  const chaos = data.chaos_ratio_control;
  if (!chaos.auto_enabled || chaos.human_override_active) {
    return { adjusted: false, reason: "human_override_or_disabled" };
  }

  const current = chaos.current;
  const [min, max] = chaos.auto_range;
  const step = chaos.auto_step;
  const target = (min + max) / 2;
  const deviation = current - target;

  if (Math.abs(deviation) < step * 0.5) {
    return { adjusted: false, chaos_before: current, chaos_after: current, reason: "within_tolerance" };
  }

  const newVal = Math.max(chaos.min, Math.min(chaos.max, current - Math.sign(deviation) * step));
  chaos.current = newVal;

  chaos.adjustment_log = chaos.adjustment_log || [];
  chaos.adjustment_log.push({
    timestamp: new Date().toISOString(),
    trigger: "thermostat",
    chaos_from: current,
    chaos_to: newVal,
    deviation,
    reason: deviation > 0 ? "chaos_too_high" : "chaos_too_low",
  });
  if (chaos.adjustment_log.length > 50) chaos.adjustment_log = chaos.adjustment_log.slice(-50);

  return { adjusted: true, chaos_before: current, chaos_after: newVal, deviation: Math.round(deviation * 1000) / 1000, reason: deviation > 0 ? "chaos_too_high" : "chaos_too_low" };
}

/**
 * TRI-THERMO-2: 生成有序程度调节面板文本
 */
function renderChaosPanel(data) {
  const chaos = data.chaos_ratio_control || {};
  const tri = data.tri_conjugate || {};
  const O = Math.round((tri.current?.O || 0.5) * 100);
  const C = Math.round((tri.current?.C || 0.5) * 100);
  const N = Math.round((tri.current?.N || 0.05) * 100);
  const Q = Math.round((tri.current?.N_quality || 0.2) * 100);
  const chaosVal = chaos.current || 0.15;
  const [min, max] = chaos.auto_range || [0.10, 0.20];

  const bar = (val) => {
    const filled = Math.round(val / 100 * 20);
    return "█".repeat(filled) + "░".repeat(20 - filled);
  };
  const chaosFilled = Math.round(chaosVal * 20);
  const chaosBar = "█".repeat(chaosFilled) + "░".repeat(20 - chaosFilled);
  const mode = chaos.human_override_active ? "⚠ 手动模式" : "◎ 自动模式";
  const triState = tri.current?.tri_state || "unknown";

  return "\n╔══════════════════════════════════════════════════════════════╗\n║           有序程度调节器 · 当前状态  (v1.6)                    ║\n╠══════════════════════════════════════════════════════════════╣\n║                                                              ║\n║   系统有序度    " + bar(O) + " " + O + "%                       ║\n║   系统混沌度    " + bar(C) + " " + C + "%                       ║\n║   人类介入度    " + bar(N) + " " + N + "%                       ║\n║   输入质量系数  " + bar(Q) + " " + Q + "%                       ║\n║                                                              ║\n║   ─────────────────────────────────────────────────────────  ║\n║   当前混沌比例 = " + chaosVal.toFixed(2) + "  " + chaosBar + "        ║\n║   恒温器区间   [" + (min).toFixed(2) + ", " + (max).toFixed(2) + "]                           ║\n║   控制模式     " + (mode + "（/自动驾驶 恢复）").substring(0, 36).padEnd(36) + "║\n║                                                              ║\n║   三方状态     " + triState.padEnd(36) + "║\n╠══════════════════════════════════════════════════════════════╣\n║                   可用的调节指令                              ║\n╠══════════════════════════════════════════════════════════════╣\n║                                                              ║\n║   /偏天才 ── chaos_ratio -0.10（更有序，减少荒诞跳跃）      ║\n║   /偏疯子 ── chaos_ratio +0.10（更混沌，增加随机探路）      ║\n║                                                              ║\n║   /太敏感 ── 僵局触发更难（荒诞生成减少）                   ║\n║   /太迟钝 ── 僵局触发更容易（荒诞生成增加）                ║\n║                                                              ║\n║   /太挤了 ── 清理低价值荒诞记忆                             ║\n║   /太空了 ── 保留更多记忆，减少清理                         ║\n║                                                              ║\n║   /平衡度 ── 再次显示本面板                                 ║\n║   /参数履历 ── 查看最近10次调整记录                        ║\n║   /自动驾驶 ── 恢复系统自动微调                             ║\n║                                                              ║\n╚══════════════════════════════════════════════════════════════╝\n";
}

// ============================================================================
// INDEX 模块：混合索引（有序数组 + 跳跃表）v1.5
// ============================================================================
const MAX_SKIPLIST_LEVEL = 16;

function randomSkipLevel() {
  let level = 0;
  while (Math.random() < 0.5 && level < MAX_SKIPLIST_LEVEL - 1) level++;
  return level;
}

function insertSkiplistNode(data, hash) {
  const meta = data.meta;
  const skiplistHead = meta.skiplist_head;
  if (!meta.skiplist_next) meta.skiplist_next = {};
  if (!meta.skiplist_next[skiplistHead]) meta.skiplist_next[skiplistHead] = new Array(MAX_SKIPLIST_LEVEL).fill(null);
  if (!meta.skiplist_next[hash]) meta.skiplist_next[hash] = new Array(MAX_SKIPLIST_LEVEL).fill(null);

  const level = randomSkipLevel();
  const headNext = meta.skiplist_next[skiplistHead];
  const _update = {};

  for (let i = MAX_SKIPLIST_LEVEL - 1; i >= 0; i--) {
    let current = skiplistHead;
    while (headNext[i] && headNext[i] < hash) {
      current = headNext[i];
      if (!meta.skiplist_next[current]) meta.skiplist_next[current] = new Array(MAX_SKIPLIST_LEVEL).fill(null);
      const next = meta.skiplist_next[current][i];
      if (!next || next >= hash) break;
    }
    _update[i] = current;
  }

  for (let i = 0; i <= level; i++) {
    const prev = _update[i] || skiplistHead;
    if (!meta.skiplist_next[prev]) meta.skiplist_next[prev] = new Array(MAX_SKIPLIST_LEVEL).fill(null);
    meta.skiplist_next[hash][i] = meta.skiplist_next[prev][i];
    meta.skiplist_next[prev][i] = hash;
  }
}

function skiplistRandomWalk(meta, steps = 5) {
  const skiplistNext = meta.skiplist_next;
  let current = meta.skiplist_head;
  const path = [current];

  for (let s = 0; s < steps; s++) {
    const currentNext = skiplistNext[current];
    if (!currentNext) break;
    let next = null;
    for (let level = MAX_SKIPLIST_LEVEL - 1; level >= 0; level--) {
      const candidate = currentNext[level];
      if (candidate) {
        if (Math.random() > 0.5) { next = candidate; break; }
      }
    }
    if (!next) break;
    current = next;
    path.push(current);
  }
  return { hash: current, mode: "chaotic", path };
}

/**
 * INDEX-1: 混合随机选取（chaos_ratio 驱动）
 */
function hybridRandomSelect(data, mode) {
  const tri = data.tri_conjugate || {};
  const meta = data.meta || {};
  const idx = meta.index_aliases || [];
  const chaos = data.chaos_ratio_control || {};

  if (!mode) {
    // chaos_ratio > 0.5 → chaotic 模式
    mode = (chaos.current || 0.15) > 0.5 ? "chaotic" : "ordered";
  }

  if (mode === "ordered" && idx.length > 0) {
    const sel = idx[Math.floor(Math.random() * idx.length)];
    meta.active_index_mode = "ordered";
    return { hash: sel, mode: "ordered" };
  }

  if (!meta.skiplist_next || !meta.skiplist_head) {
    if (idx.length > 0) {
      const sel = idx[Math.floor(Math.random() * idx.length)];
      meta.active_index_mode = "ordered_fallback";
      return { hash: sel, mode: "ordered_fallback" };
    }
    return { hash: null, mode: "none" };
  }

  meta.active_index_mode = "chaotic";
  return skiplistRandomWalk(meta, 5);
}

function indexAddNode(data, hash) {
  const meta = data.meta;
  if (!meta.index_aliases) meta.index_aliases = [];
  if (!meta.index_aliases.includes(hash)) meta.index_aliases.push(hash);
  if (!meta.skiplist_head) meta.skiplist_head = "00000000000000000000000000000000";
  insertSkiplistNode(data, hash);
}

function indexRemoveNode(data, hash) {
  const meta = data.meta;
  if (meta.index_aliases) {
    const idx = meta.index_aliases.indexOf(hash);
    if (idx !== -1) meta.index_aliases[idx] = null;
  }
}

function indexCompact(data) {
  if (data.meta.index_aliases) {
    data.meta.index_aliases = data.meta.index_aliases.filter(Boolean);
  }
}

function initSkiplist(data) {
  const meta = data.meta;
  if (!meta.skiplist_head) meta.skiplist_head = "00000000000000000000000000000000";
  if (!meta.skiplist_next) meta.skiplist_next = {};
  const head = meta.skiplist_head;
  if (!meta.skiplist_next[head]) meta.skiplist_next[head] = new Array(MAX_SKIPLIST_LEVEL).fill(null);
}

// ============================================================================
// TRIGGER 模块：触发协议 v1.5
// ============================================================================

/**
 * TRIGGER-1: 僵局检测
 */
function detectDeadlockSignals(data) {
  const tri = data.tri_conjugate || {};
  const history = (tri.history || []).slice(-20);
  if (history.length < 5) return { deadlock: false, signal: null, anchor: null };

  const lastSteps = Math.min(history.length, 10);
  const recent = history.slice(-lastSteps);

  // 信号1：O/C 极化（|O-C| > 0.85）
  const resonance_width = Math.abs(tri.current.O - tri.current.C);
  if (resonance_width > 0.85) {
    return { deadlock: true, signal: "O_C_polarization", anchor: recent[recent.length - 1]?.O > 0.7 ? "ordered" : "chaotic", severity: resonance_width };
  }

  // 信号2：连续无锚点快照
  const anchorCount = recent.filter((h) => h.state === "NORMAL_RESONANCE" || h.state === "FLOW_RESONANCE").length;
  if (lastSteps >= 6 && anchorCount === 0) {
    return { deadlock: true, signal: "no_anchor_snapshot", anchor: recent[0]?.hash || null, severity: 1.0 };
  }

  return { deadlock: false, signal: null, anchor: null };
}

/**
 * TRIGGER-2: 僵局触发（类型一）
 */
function triggerType1Deadlock(data) {
  const deadlock = detectDeadlockSignals(data);
  if (!deadlock.deadlock) return null;

  const { signal, anchor, severity } = deadlock;
  const params = data.adaptive_tuning?.current_params || {};
  const triggerThreshold = params.deadlock_trigger_threshold || 3;

  if (severity < 0.3) return null;

  const anchors = Object.entries(data.nodes).filter(([, n]) => n.anchor_type === "meaningful");
  if (anchors.length === 0) return null;

  const anchorHash = typeof anchor === "string" ? anchor : anchors[0][0];
  const kPerScale = params.k_per_scale || 3;
  const scalesActive = { micro: true, meso: true, macro: true };

  const written = writeAbsurdVariants(data, anchorHash, { kPerScale, scalesActive });

  data.trigger_log.push({
    timestamp: new Date().toISOString(),
    type: "type1_deadlock",
    signal,
    anchor_used: anchorHash,
    variants_generated: written.map((v) => v.hash),
    severity,
  });

  return { type: "type1_deadlock", signal, anchor: anchorHash, variants: written };
}

/**
 * TRIGGER-3: 随机蔓生触发（类型三）
 */
function triggerType3Random(data) {
  const params = data.adaptive_tuning?.current_params || {};
  const baseProb = params.random_prob_base || 0.05;
  const C = data.tri_conjugate?.current?.C || 0.5;
  const prob = baseProb + C * 0.15;
  if (Math.random() > prob) return null;

  const anchors = Object.entries(data.nodes).filter(([, n]) => n.anchor_type === "meaningful");
  if (anchors.length === 0) return null;

  const anchorHash = anchors[Math.floor(Math.random() * anchors.length.length)][0];
  const written = writeAbsurdVariants(data, anchorHash, { kPerScale: 1, scalesActive: { micro: true, meso: false, macro: false } });

  data.trigger_log.push({ timestamp: new Date().toISOString(), type: "type3_random", anchor_used: anchorHash, variants_generated: written.map((v) => v.hash), prob_used: prob });

  return { type: "type3_random", anchor: anchorHash, variants: written };
}

/**
 * TRIGGER-4: 人类主动触发（类型二）
 */
function triggerType2Human(data, anchorHash, options = {}) {
  const params = data.adaptive_tuning?.current_params || {};
  const scales = options.scales || { micro: true, meso: true, macro: true };
  const k = options.k || params.k_per_scale || 3;

  const written = writeAbsurdVariants(data, anchorHash, { kPerScale: k, scalesActive: scales });

  data.trigger_log.push({ timestamp: new Date().toISOString(), type: "type2_human", anchor_used: anchorHash, variants_generated: written.map((v) => v.hash), command_options: options });

  updateTriConjugate(data, "human_intervention", { reason: "type2_absurd", N_injected: 0.2, humanInput: "荒诞生成锚点: " + anchorHash });

  return { type: "type2_human", anchor: anchorHash, variants: written };
}

/**
 * TRIGGER-5: 检查点主函数
 */
function triggerCheckpoint(data, checkpointType) {
  checkpointType = checkpointType || "before_reasoning";
  const results = [];
  if (checkpointType === "before_reasoning") {
    const r1 = triggerType1Deadlock(data);
    if (r1) results.push(r1);
    const r3 = triggerType3Random(data);
    if (r3) results.push(r3);
  }
  return results;
}

// ============================================================================
// ADAPTIVE 模块：自适应调参 v1.6
// ============================================================================

/**
 * ADAPTIVE-1: 初始化先验参数
 */
function initPriorParams() {
  return {
    target_range: [500, 2000],
    min_utility_threshold: 0.1,
    k_per_scale: 3,
    N_baseline: 0.05,
    signal_buffer_threshold: 5,
    adjustment_step_max: 0.10,
    coupling_strength: 1.5,
  };
}

/**
 * ADAPTIVE-2: 采集隐式反馈信号
 * v1.6: 移除 "long_silence"
 */
function collectImplicitFeedback(data, eventType) {
  const adaptive = data.adaptive_tuning;
  const buf = adaptive?.signal_buffer;
  if (!buf) return null;

  let signal = null;
  let polarity = 0;

  switch (eventType) {
    case "rated_noise": signal = { type: "implicit_negative", category: "node_rating" }; polarity = -1; break;
    case "rated_surprise": signal = { type: "implicit_positive", category: "node_rating" }; polarity = 1; break;
    case "rated_anchor": signal = { type: "implicit_positive", category: "node_rating" }; polarity = 1; break;
    case "continued_flow": signal = { type: "implicit_positive", category: "engagement" }; polarity = 1; break;
    case "human_command": signal = { type: "explicit_feedback", category: "command" }; polarity = 0; break;
    default: return null;
  }

  buf.push({ ...signal, polarity, timestamp: new Date().toISOString() });
  return { signal, polarity };
}

/**
 * ADAPTIVE-3: 人类显式调参指令 v1.6
 * 10 个中文触发词 + chaos_ratio 连续参数
 */
/**
 * INTENT-1: 自然语言意图解析 v1.7
 *
 * 意图映射表（离线静态定义）
 * 系统理解人类意图，不要求人类记忆精确指令。
 */
const INTENT_MAP = {
  // 存储类意图
  store: {
    patterns: [/\b存\b/, /\b记\b/, /\b留\b/, /\b保留\b/, /\b有用\b/, /\b好\b/, /\b要这个\b/, /\b记住\b/],
    context_rules: "最近一次选中的路径 或 最近讨论中表现出价值的荒诞记忆",
    disambiguation: "if 多个可存储目标 → 用选择题问人类选哪个",
  },
  // 寻路类意图
  pathfind: {
    patterns: [/\b寻路\b/, /\b找路\b/, /\b换路\b/, /\b试试别的\b/, /\b切\b/, /\b撞\b/, /\b蔓生\b/, /\b荒诞\b/, /\b发散\b/, /\b来点疯\b/, /\b换一批\b/],
    context_rules: "当前不在寻路模式中时触发",
    disambiguation: null,
  },
  // 弃选类意图
  redraw: {
    patterns: [/\b再找\b/, /\b再寻\b/, /\b换一批\b/, /\b不对\b/, /\b不是\b/, /\b不行\b/, /\b没感觉\b/, /\b继续找\b/],
    context_rules: "当前在寻路模式中且候选清单已展示",
    disambiguation: null,
  },
  // 回归类意图
  return_to_token: {
    patterns: [/\b回去\b/, /\b继续\b/, /\b接着推\b/, /\b正常走\b/, /\b算了\b/, /\b先不管\b/],
    context_rules: "当前在寻路模式中时触发；if 也在有序追踪中 → 判断为继续当前方向",
    disambiguation: null,
  },
};

/**
 * INTENT-2: 检查文本是否匹配给定意图
 */
function matchIntent(text, intentKey) {
  const intent = INTENT_MAP[intentKey];
  if (!intent) return false;
  return intent.patterns.some((p) => p.test(text));
}

/**
 * INTENT-3: 根据上下文判断存储意图的具体目标 v1.7
 *
 * "存下"在三种不同场景下有不同的目标：
 *   场景A: 刚选了路径A → 存储路径A的凝结核
 *   场景B: 刚自己说了高价值洞察 → 系统问"存洞察还是存探针"
 *   场景C: 候选清单未选 → 系统问"想存哪条？A/B/C？"
 *
 * @returns { target_type, target_info, ambiguous, options }
 */
function resolveStorageContext(data, text) {
  const cc = data.conversation_context || {};
  const session = cc.pathfind_session;
  const candidates = session?.candidates || [];

  const hasSelection = session?.selected && session.selected !== null;
  const hasMultiCandidates = candidates.length > 1 && !hasSelection;

  // 场景A：刚选了路径，直接存
  if (hasSelection) {
    return {
      target_type: "selected_path",
      target_info: { session_id: session.id, selection: session.selected, candidate: candidates[parseInt(session.selected.charCodeAt(0) - 65)] },
      ambiguous: false,
      options: null,
    };
  }

  // 场景B：有多个候选但还没选
  if (hasMultiCandidates) {
    return {
      target_type: "unselected_candidates",
      target_info: { candidates },
      ambiguous: true,
      options: candidates.map((c, i) => ({ label: String.fromCharCode(65 + i), value: i, display: c.substring(0, 20) + (c.length > 20 ? "…" : "") })),
    };
  }

  // 场景C：无明确候选，存当前锚点
  if (cc.current_anchor) {
    return {
      target_type: "current_anchor",
      target_info: { anchor: cc.current_anchor, anchor_hash: cc.current_anchor_hash },
      ambiguous: false,
      options: null,
    };
  }

  // 完全无法判断
  return {
    target_type: "unknown",
    target_info: null,
    ambiguous: true,
    options: [{ label: "A", value: 0, display: "刚才的讨论锚点" }],
  };
}

/**
 * INTENT-4: 主意图解析函数（替代 parseHumanTuneCommand 的模糊意图部分）
 * 对人类输入进行意图推断，对歧义情况进行消歧返回
 */
function resolveHumanIntent(data, command) {
  const cmd = command.trim();
  const cc = data.conversation_context || {};
  const inPathfind = cc.pathfind_session !== null;

  // 精确指令优先（保留精确指令兼容性）
  if (cmd === "/有序调节器" || cmd === "有序调节器") return { action: "show_panel", description: "显示有序程度调节面板" };
  if (cmd === "/偏天才" || cmd === "偏天才") return { action: "chaos_ratio_delta", delta: -0.10, description: "chaos_ratio -0.10", category: "chaos" };
  if (cmd === "/偏疯子" || cmd === "偏疯子") return { action: "chaos_ratio_delta", delta: 0.10, description: "chaos_ratio +0.10", category: "chaos" };
  if (cmd === "/太挤了" || cmd === "太挤了") return { action: "memory_pool_delta", delta: -200, description: "降低节点池上限", category: "memory" };
  if (cmd === "/太空了" || cmd === "太空了") return { action: "memory_pool_delta", delta: 200, description: "提高节点池下限", category: "memory" };
  if (cmd === "/太敏感" || cmd === "太敏感") return { action: "deadlock_threshold_delta", delta: 2, description: "僵局触发更难", category: "trigger" };
  if (cmd === "/太迟钝" || cmd === "太迟钝") return { action: "deadlock_threshold_delta", delta: -1, description: "僵局触发更容易", category: "trigger" };
  if (cmd === "/平衡度" || cmd === "平衡度") return { action: "show_panel", description: "显示三方共轭仪表盘" };
  if (cmd === "/参数履历" || cmd === "参数履历") return { action: "show_history", description: "显示最近10次参数调整记录" };
  if (cmd === "/自动驾驶" || cmd === "自动驾驶") return { action: "resume_autopilot", description: "恢复恒温器自动微调", category: "autopilot" };
  if (cmd === "/寻路" || cmd === "寻路") return { action: "pathfind", description: "启动荒诞寻路", category: "pathfind" };
  if (cmd === "/再找" || cmd === "再找") return { action: "pathfind_reroll", description: "换一批荒诞探针", category: "pathfind" };
  if (cmd === "/回TOKEN" || cmd === "回TOKEN") return { action: "pathfind_exit", description: "退出寻路，回到有序追踪", category: "pathfind" };
  if (cmd === "/寻路记录" || cmd === "寻路记录") return { action: "pathfind_history", description: "查询寻路历史记录", category: "pathfind" };

  // 带锚点参数的 /寻路
  const pathfindWithAnchor = cmd.match(/^\/?寻路[：:\s]*(.+)$/);
  if (pathfindWithAnchor) {
    return { action: "pathfind", anchor: pathfindWithAnchor[1].trim(), description: "从指定锚点启动荒诞寻路", category: "pathfind" };
  }

  // 路径选择 A/B/C
  const pathSelect = cmd.match(/^[A-Za-z][\.、]?\s*$/);
  if (pathSelect) {
    const sel = cmd[0].toUpperCase();
    if (sel >= "A" && sel <= "Z") {
      return { action: "pathfind_select", selection: sel, description: "选择荒诞路径 " + sel, category: "pathfind" };
    }
  }

  // 精确 chaos 设置
  const directMatch = cmd.match(/^\/?chaos[:：]?\s*([\d.]+)$/);
  if (directMatch) {
    const val = parseFloat(directMatch[1]);
    if (val >= 0 && val <= 1) return { action: "chaos_ratio_set", value: val, description: "直接设置 chaos_ratio = " + val, category: "chaos" };
  }

  // ============ 自然语言意图推断部分（v1.7 新增）============

  // 存储类意图 — 需要上下文消歧
  const storePatterns = [
    /^[\/]?这个存[下]?[来]?[呀]?[！!]?$/,
    /^[\/]?存[下]?[来]?[呀]?[！!]?$/,
    /^[\/]?记[下]?[来]?[呀]?[！!]?$/,
    /^[\/]?凝[结]?[核]?[呀]?[！!]?$/,
    /^[\/]?这个记[下]?$/,
    /^[\/]?把.*存(起来)?$/,
    /^[\/]?这个路径存[下]?[来]?$/,
    /^[\/]?选.*存[下]?[来]?$/,
    /^存[了]?[下]?[来]?$/,
    /^留[下]?[来]?$/,
    /^凝结$/,
    /^凝核$/,
    /^存了$/,
    /^凝！$/,
    /^存！$/,
  ];
  if (storePatterns.some((p) => p.test(cmd))) {
    const ctx = resolveStorageContext(data, cmd);
    if (ctx.ambiguous && ctx.options && ctx.options.length > 1) {
      // 歧义：返回选择题，让人类确认
      return { action: "store_ambiguous", target_type: ctx.target_type, options: ctx.options, description: "不确定存哪个" };
    }
    // 无歧义：直接返回凝结核意图
    return { action: "condense", target_type: ctx.target_type, target_info: ctx.target_info, description: "将选中的荒诞路径凝结为有序锚点", category: "pathfind" };
  }

  // 寻路类意图（自然语言）— 排除已在寻路模式中（那应该触发 redraw 或 return）
  if (matchIntent(cmd, "pathfind") && !inPathfind) {
    return { action: "pathfind", description: "启动荒诞寻路", category: "pathfind" };
  }

  // 弃选类意图（自然语言）
  if (matchIntent(cmd, "redraw") && inPathfind) {
    return { action: "pathfind_reroll", description: "换一批荒诞探针", category: "pathfind" };
  }

  // 回归类意图（自然语言）— "继续"需要特殊处理
  if (cmd === "继续" || cmd === "继续。") {
    if (inPathfind) return { action: "pathfind_exit", description: "退出寻路，回到有序追踪", category: "pathfind" };
    return null; // 有序追踪中继续 = 无操作，静默放过
  }
  if (matchIntent(cmd, "return_to_token") && inPathfind) {
    return { action: "pathfind_exit", description: "退出寻路，回到有序追踪", category: "pathfind" };
  }

  return null;
}

/**
 * INTENT-5: 选择题 UI 渲染 v1.7
 * 当系统无法消歧时，用最短提问替代错误提示
 */
function renderChoicePanel(question, options, context) {
  const opts = options.map((o) => `${o.label}. ${o.display}`).join("\n");
  return `🤔 ${question}

${opts}

回复选项字母即可（例如：A）`;
}

// 保持向后兼容别名
const parseHumanTuneCommand = resolveHumanIntent;

/**
 * ADAPTIVE-4: 执行参数调整（信号缓冲）
 */
function runAdaptiveTuning(data) {
  const adaptive = data.adaptive_tuning;
  if (!adaptive) return { adjusted: false, reason: "no_adaptive_module" };
  const params = adaptive.current_params;
  const buf = adaptive.signal_buffer;
  const threshold = params?.signal_buffer_threshold || 5;
  const stepMax = params?.step_max || 0.1;

  if (buf.length < threshold) return { adjusted: false, reason: "buffer_not_full" };

  const positives = buf.filter((s) => s.polarity === 1).length;
  const negatives = buf.filter((s) => s.polarity === -1).length;
  const total = buf.length;
  let adjustments = [];

  if (negatives > positives * 1.5) {
    const categories = buf.filter((s) => s.polarity === -1).map((s) => s.category);
    if (categories.includes("node_rating")) adjustments.push({ param: "min_utility_threshold", delta: 0.05, reason: "人类频繁标记噪声" });
    if (categories.includes("engagement")) adjustments.push({ param: "deadlock_trigger_threshold", delta: -1, reason: "人类沉默，疑似系统无价值" });
  } else if (positives > negatives * 1.5) {
    adjustments.push({ param: "target_range_max", delta: 100, reason: "系统运行良好，扩大节点容量" });
  }

  for (const adj of adjustments) {
    if (params[adj.param] !== undefined) {
      const oldVal = params[adj.param];
      const newVal = oldVal + adj.delta;
      params[adj.param] = Math.max(oldVal - stepMax, Math.min(oldVal + stepMax, newVal));
    }
  }

  adaptive.adjustment_log.push({
    timestamp: new Date().toISOString(),
    trigger: "adaptive_tuning",
    signals_count: total,
    signal_distribution: { positive: positives, negative: negatives },
    adjustments,
    human_override: false,
  });
  if (adaptive.adjustment_log.length > 50) adaptive.adjustment_log = adaptive.adjustment_log.slice(-50);

  adaptive.signal_buffer = [];
  const recent3 = adaptive.adjustment_log.slice(-3);
  if (recent3.length >= 3 && recent3.every((l) => l.adjustments.length === 0)) adaptive.params_stable = true;

  return { adjusted: adjustments.length > 0, adjustments, params_stable: adaptive.params_stable, buf_cleared: true };
}

/**
 * ADAPTIVE-5: 应用人类显式调参 v1.6
 */
function applyHumanTune(data, command) {
  const parsed = parseHumanTuneCommand(command);
  if (!parsed) return null;

  const adaptive = data.adaptive_tuning;
  const params = adaptive?.current_params || {};
  const chaos = data.chaos_ratio_control || {};

  if (parsed.action === "show_panel") {
    return { action: "show_panel", dashboard: getTriDashboard(data), chaos_control: chaos };
  }
  if (parsed.action === "show_history") {
    const recent = (adaptive?.adjustment_log || []).slice(-10);
    // v1.7: 同时显示 pathfinding_log 精简摘要
    const pfLog = (data.pathfinding_log || []).slice(-5).map((e) => ({
      time: e.timestamp ? new Date(e.timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "?",
      anchor: e.anchor ? e.anchor.substring(0, 15) + (e.anchor.length > 15 ? "…" : "") : "?",
      selected: e.human_selection ? String.fromCharCode(64 + parseInt(e.human_selection.charCodeAt(0) - 64)) : "?",
      absurd: e.selected_absurd ? e.selected_absurd.substring(0, 12) + "…" : "?",
    }));
    return { action: "show_history", history: recent, pathfinding_summary: pfLog };
  }
  // v1.7: 寻路历史查询
  if (parsed.action === "pathfind_history") {
    const log = (data.pathfinding_log || []).slice(-10).reverse();
    return { action: "pathfind_history", entries: log, count: log.length };
  }
  if (parsed.action === "resume_autopilot") {
    chaos.auto_enabled = true;
    chaos.human_override_active = false;
    const target = ((chaos.auto_range || [0.10, 0.20])[0] + (chaos.auto_range || [0.10, 0.20])[1]) / 2;
    if (Math.abs(chaos.current - target) > 0.05) {
      chaos.current = chaos.current + Math.sign(target - chaos.current) * Math.min(0.05, Math.abs(target - chaos.current));
    }
    adaptive?.adjustment_log?.push({ timestamp: new Date().toISOString(), trigger: "human_command", command: "/自动驾驶", action: "resume_autopilot", chaos_current: chaos.current });
    return { action: "resume_autopilot", chaos_current: chaos.current, auto_enabled: true, message: "恒温器已恢复" };
  }

  if (parsed.action === "chaos_ratio_delta" || parsed.action === "chaos_ratio_set") {
    const oldVal = chaos.current;
    let newVal;
    if (parsed.action === "chaos_ratio_set") {
      newVal = Math.max(chaos.min, Math.min(chaos.max, parsed.value));
    } else {
      newVal = Math.max(chaos.min, Math.min(chaos.max, oldVal + parsed.delta));
    }
    chaos.current = newVal;
    chaos.human_override_active = true;
    chaos.auto_enabled = false;
    chaos.last_human_override = new Date().toISOString();
    if (params.absurdity_level !== undefined) params.absurdity_level = newVal;
    adaptive?.adjustment_log?.push({ timestamp: new Date().toISOString(), trigger: "human_command", command: parsed.action === "chaos_ratio_set" ? "chaos:" + newVal : (parsed.delta > 0 ? "/偏疯子" : "/偏天才"), chaos_from: oldVal, chaos_to: newVal, description: parsed.description, human_override: true });
    return { action: parsed.action, chaos_before: oldVal, chaos_after: newVal, message: parsed.description };
  }

  // PATHFIND v1.7 命令处理
  if (parsed.category === "pathfind") {
    if (parsed.action === "pathfind") {
      const explicitAnchor = parsed.anchor || null;
      const result = runPathfind(data, explicitAnchor, 4);
      if (result.error) return result;
      return {
        action: "pathfind_started",
        panel: renderPathfindPanel(data, result.anchor, result.candidates),
        session: result.session,
        message: "🔀 荒诞寻路已启动，当前锚点：" + result.anchor,
      };
    }
    if (parsed.action === "pathfind_reroll") {
      const explicitAnchor = data.conversation_context?.pathfind_session?.anchor || null;
      const result = runPathfind(data, explicitAnchor, 4);
      if (result.error) return result;
      return {
        action: "pathfind_rerolled",
        panel: renderPathfindPanel(data, result.anchor, result.candidates),
        session: result.session,
        message: "🔀 已换一批探针，当前锚点：" + result.anchor,
      };
    }
    if (parsed.action === "pathfind_exit") {
      const exitResult = exitPathfindSession(data);
      save(data);
      return { action: "pathfind_exit", ...exitResult };
    }
    if (parsed.action === "pathfind_select") {
      const result = recordCondensedNucleus(data, parsed.selection);
      save(data);
      return {
        action: "condensed",
        ...result,
        message: result.message || "凝结核已保存",
      };
    }
  }

  const delta = parsed.delta;
  const paramMap = { "memory_pool_delta": "target_range_max", "deadlock_threshold_delta": "deadlock_trigger_threshold" };
  const param = paramMap[parsed.action];
  if (param && delta !== undefined) {
    const oldVal = params[param] || 0;
    params[param] = Math.max(0, oldVal + delta);
    chaos.human_override_active = true;
    chaos.auto_enabled = false;
    adaptive?.adjustment_log?.push({ timestamp: new Date().toISOString(), trigger: "human_command", action: parsed.action, adjustments: [{ param, from: oldVal, to: params[param], reason: parsed.description }], human_override: true });
    return { param, from: oldVal, to: params[param], description: parsed.description };
  }

  return null;
}

/**
 * ADAPTIVE-6: 获取调参状态摘要
 */
function getAdaptiveSummary(data) {
  const adaptive = data.adaptive_tuning;
  return {
    params_stable: adaptive?.params_stable || false,
    signal_buffer_count: (adaptive?.signal_buffer || []).length,
    signal_buffer_threshold: adaptive?.current_params?.signal_buffer_threshold || 5,
    current_params: adaptive?.current_params,
    recent_adjustments: (adaptive?.adjustment_log || []).slice(-5),
  };
}

// ============================================================================
// 导出
// ============================================================================

// ============================================================================
// PATHFIND 模块 v1.7：荒诞→有序转化循环
// ============================================================================

/**
 * PF-1: 更新当前讨论锚点
 * 由 TOKEN 每轮结束时调用（A2 模式：自动记录）
 * @param {object} data - pool data
 * @param {string} anchorText - 当前讨论主题（可从最后一条消息提取）
 * @param {object} turnMetrics - 可选：本轮推理指标
 *   turnMetrics.info_new: 新增命题数
 *   turnMetrics.self_ref: 自引用比例 (0-1)
 *   turnMetrics.has_snapshot: 是否有美学快照
 */
function updateConversationAnchor(data, anchorText, turnMetrics = {}) {
  const cc = data.conversation_context || {};
  const prev = cc.current_anchor;

  cc.current_anchor = anchorText;
  cc.turn_count = (cc.turn_count || 0) + 1;
  cc.last_discussion_topic = anchorText;
  cc.health_signals = cc.health_signals || {
    info_decline_turns: 0, self_ref_turns: 0,
    last_aesthetic_turn: 0, warning_delivered: false,
  };

  // 更新健康信号
  const hs = cc.health_signals;
  const threshold = data.adaptive_tuning?.current_params?.deadlock_trigger_threshold || 3;

  if (turnMetrics.info_new !== undefined) {
    // 信息增量衰减检测（相对上一轮下降）
    if (turnMetrics.info_new < 1) {
      hs.info_decline_turns++;
    } else {
      hs.info_decline_turns = Math.max(0, hs.info_decline_turns - 1);
    }
  }

  if (turnMetrics.self_ref !== undefined) {
    if (turnMetrics.self_ref > 0.5) {
      hs.self_ref_turns++;
    } else {
      hs.self_ref_turns = Math.max(0, hs.self_ref_turns - 1);
    }
  }

  if (turnMetrics.has_snapshot) {
    hs.last_aesthetic_turn = cc.turn_count;
    hs.warning_delivered = false; // 重置提醒
  }

  // 保存锚点在池中的哈希（精确匹配）
  if (anchorText && data.nodes) {
    const matched = Object.values(data.nodes).find(
      (n) => n.head === anchorText || n.body === anchorText || n.body.startsWith(anchorText)
    );
    cc.current_anchor_hash = matched ? matched.head : null;
  }

  data.conversation_context = cc;
  return cc;
}

/**
 * PF-2: 检查推理健康状态，叠加信号触发时返回警告
 * @returns {object|null} 警告对象或 null
 */
function checkReasoningHealth(data) {
  const cc = data.conversation_context || {};
  const hs = cc.health_signals || {};
  // v1.7: 使用配置化阈值
  const ht = cc.health_thresholds || {};
  const threshold = ht.deadlock_trigger_threshold || data.adaptive_tuning?.current_params?.deadlock_trigger_threshold || 3;
  const thresholdPairs = ht.threshold_pairs || 2; // v1.7: 任意2+信号叠加触发
  const snapshotMultiplier = ht.snapshot_gap_multiplier || 2;

  const signals = [];

  if (hs.info_decline_turns >= threshold) {
    signals.push("新增命题数持续下降（信息增量衰减）");
  }
  if (hs.self_ref_turns >= threshold) {
    signals.push("自引用比例升高（在吃自己的尾气）");
  }
  const snapshotGap = cc.turn_count - (hs.last_aesthetic_turn || 0);
  if (snapshotGap >= threshold * snapshotMultiplier) {
    signals.push("较长时间无美学快照（无高价值洞察）");
  }

  // v1.7: 只有信号数量 >= threshold_pairs 时才触发
  if (signals.length < thresholdPairs || hs.warning_delivered) return null;

  // 标记已发送（避免重复）
  cc.health_signals = cc.health_signals || {};
  cc.health_signals.warning_delivered = true;

  return {
    type: "health_warning",
    signals,
    turn_count: cc.turn_count,
    anchor: cc.current_anchor,
    message:
      "⚠️ 最近推理中：\n" +
      signals.map((s) => "  · " + s).join("\n") +
      "\n\n这不一定意味着卡死，但建议你感知一下。\n如需切换寻路模式，回复 /寻路",
  };
}

/**
 * PF-3: 荒诞候选选取
 * 使用 chaos_ratio 控制荒诞程度，从蔓生池中选取探针
 */
function selectAbsurdProbes(data, anchorHash, k = 4, chaosOverride = null) {
  const chaos = chaosOverride !== null ? chaosOverride : (data.chaos_ratio_control?.current || 0.15);
  const absurdNodes = Object.values(data.nodes || {}).filter(
    (n) => n.source === "absurd_generator" || n.anchor_type !== "meaningful"
  );

  if (absurdNodes.length === 0) {
    // 池里没有荒诞节点——从所有节点中选（兜底）
    const allKeys = Object.keys(data.nodes || {});
    return pickRandomNodes(allKeys, Math.min(k, allKeys.length)).map((key) => data.nodes[key]);
  }

  // chaos_ratio 控制跳跃表/有序数组的选择权重
  // chaos↑ = 更多随机；chaos↓ = 更多有序（高频激活）
  const orderedNodes = absurdNodes.filter((n) => (n.meta?.access_count || 0) > 0);
  const trulyRandom = absurdNodes.filter((n) => (n.meta?.access_count || 0) === 0);

  const orderedCount = Math.round(k * (1 - chaos));
  const randomCount = k - orderedCount;

  const ordered = pickRandomNodes(orderedNodes.map((n) => n), Math.min(orderedCount, orderedNodes.length));
  const random = pickRandomNodes(trulyRandom.map((n) => n), Math.min(randomCount, trulyRandom.length));

  return [...ordered, ...random].slice(0, k);
}

/**
 * PF-4: 渲染寻路面板（供 TOKEN 调用）
 * 返回结构化对象，由 TOKEN 渲染成自然语言
 */
function renderPathfindPanel(data, anchor, candidates) {
  const cc = data.conversation_context || {};
  const chaos = data.chaos_ratio_control?.current || 0.15;

  return {
    type: "pathfind_panel",
    current_anchor: anchor,
    chaos_ratio: chaos,
    candidates: candidates.map((c, i) => ({
      id: String.fromCharCode(65 + i), // A, B, C, D...
      hash: c.head,
      absurd_head: c.head,
      absurd_body: c.body,
      source: c.source,
      generation_method: c.generation_method,
      tags: c.tags || [],
    })),
    instructions: {
      select: "回复 A / B / C → 选择一条路径继续",
      reroll: "回复 /再找 → 换一批荒诞探针",
      exit: "回复 /回TOKEN → 放弃寻路，回到有序追踪",
      inject: "直接输入你的新方向 → 人类直接注入高维洞察",
    },
    session_id: cc.pathfind_session,
  };
}

/**
 * PF-5: 执行寻路
 * @param {object} data - pool data
 * @param {string|null} explicitAnchor - 人类显式传入的锚点（A1），null 则用 conversation_context
 * @param {number} k - 候选数量，默认 4
 */
function runPathfind(data, explicitAnchor = null, k = 4) {
  // 确定锚点
  let anchor = explicitAnchor || (data.conversation_context?.current_anchor);
  let anchorHash = data.conversation_context?.current_anchor_hash;

  if (!anchor) {
    // 完全没有锚点，使用最近的锚点
    const orderedAnchors = data.flow_registry?.ordered_anchors || [];
    if (orderedAnchors.length > 0) {
      anchorHash = orderedAnchors[orderedAnchors.length - 1];
      anchor = data.nodes[anchorHash]?.head || data.nodes[anchorHash]?.body || "未知锚点";
    } else {
      return { error: "no_anchor", message: "当前没有讨论锚点，请用 /寻路：从{主题} 指定" };
    }
  }

  // 解析锚点哈希
  if (!anchorHash) {
    const matched = Object.values(data.nodes || {}).find(
      (n) => n.head === anchor || n.body === anchor || n.body.startsWith(anchor)
    );
    anchorHash = matched ? matched.head : null;
  }

  // 选取荒诞探针
  const candidates = selectAbsurdProbes(data, anchorHash, k);

  // 开启会话
  const sessionId = generateBatchId(anchorHash || anchor, Date.now());
  data.conversation_context = data.conversation_context || {};
  data.conversation_context.pathfind_session = {
    id: sessionId,
    anchor,
    anchor_hash: anchorHash,
    candidates: candidates.map((c) => c.head),
    created_at: new Date().toISOString(),
    selected: null,
    condensed: false,
  };

  return {
    anchor,
    anchor_hash: anchorHash,
    candidates,
    session: data.conversation_context.pathfind_session,
  };
}

/**
 * PF-6: 人类选择路径 → 记录凝结核
 * @param {object} data - pool data
 * @param {string} selection - "A" / "B" / "C" ...
 */
function recordCondensedNucleus(data, selection) {
  const session = data.conversation_context?.pathfind_session;
  if (!session) return { error: "no_session", message: "当前没有进行中的寻路会话" };

  const idx = selection.charCodeAt(0) - 65;
  const candidateHead = session.candidates[idx];
  if (!candidateHead) return { error: "invalid_selection", message: "无效选择 " + selection };

  const absurdNode = Object.values(data.nodes || {}).find((n) => n.head === candidateHead);
  const anchorNode = session.anchor_hash ? data.nodes[session.anchor_hash] : null;

  // 生成凝结核节点
  const timestamp = Date.now();
  const body =
    "【凝结核 v1.7】来源荒诞：" + candidateHead + "\n" +
    "起点锚点：" + session.anchor + "\n" +
    "转化时间：" + new Date(timestamp).toISOString() + "\n" +
    "来源哈希：" + (absurdNode ? absurdNode.head : "unknown") + "\n" +
    "触发方式：人类选择 " + selection;

  const hash = generateNodeKey(body, timestamp);

  data.nodes[hash] = {
    head: "凝结核：" + candidateHead.substring(0, 30),
    body,
    tags: ["凝结核", "荒诞转化", session.anchor],
    source: "condensed_nucleus",
    anchor_type: "meaningful",
    parent_hash: absurdNode ? absurdNode.head : null,
    generation_method: "condensation",
    anchor_preservation_score: 0.95,
    next_hashes: [],
    depth: 0,
    meta: {
      created_at: new Date(timestamp).toISOString(),
      last_access: new Date(timestamp).toISOString(),
      access_count: 1,
      batch_id: null,
      times_activated: 1,
      human_rating: "anchor",
    },
    aesthetic_snapshot: null,
    incoming_refs: 1,
    // v1.7 新增
    condensed_from_absurd: absurdNode ? absurdNode.head : null,
    condensed_from_anchor: session.anchor_hash,
    condensed_session_id: session.id,
    condensed_selection: selection,
  };

  // 更新原荒诞节点状态
  if (absurdNode) {
    absurdNode.anchor_type = "converted_absurd";
    absurdNode.meta = absurdNode.meta || {};
    absurdNode.meta.converted = true;
    absurdNode.meta.converted_hash = hash;
    absurdNode.meta.converted_at = new Date(timestamp).toISOString();
  }

  // 更新 flow_registry
  data.flow_registry = data.flow_registry || {};
  data.flow_registry.ordered_anchors = data.flow_registry.ordered_anchors || [];
  data.flow_registry.ordered_anchors.push(hash);
  data.flow_registry.flow_history = data.flow_registry.flow_history || [];
  data.flow_registry.current_state = "flow";
  data.flow_registry.last_human_intervention = new Date(timestamp).toISOString();
  data.flow_registry.flow_history = data.flow_registry.flow_history || [];
  data.flow_registry.flow_history.push({
    hash,
    rating: "anchor",
    timestamp: new Date(timestamp).toISOString(),
    note: "凝结核 from absurd: " + candidateHead,
  });

  // 标记会话完成
  session.selected = selection;
  session.condensed = true;
  session.condensed_hash = hash;

  // v1.7: 记录到 pathfinding_log
  data.pathfinding_log = data.pathfinding_log || [];
  data.pathfinding_log.push({
    timestamp: new Date(timestamp).toISOString(),
    session_id: session.id,
    anchor: session.anchor,
    anchor_hash: session.anchor_hash,
    candidates: session.candidates,
    human_selection: selection,
    selected_absurd: candidateHead,
    condensed_hash: hash,
    result: "selected",
  });
  // 保持最近 50 条
  if (data.pathfinding_log.length > 50) {
    data.pathfinding_log = data.pathfinding_log.slice(-50);
  }

  save(data);

  return {
    success: true,
    condensed_hash: hash,
    condensed_head: data.nodes[hash].head,
    absurd_source: candidateHead,
    message: "✅ 凝结核已保存：" + data.nodes[hash].head,
  };
}

/**
 * PF-7: 退出寻路会话
 */
function exitPathfindSession(data) {
  if (!data.conversation_context) return { message: "没有进行中的会话" };

  const session = data.conversation_context.pathfind_session;
  if (session) {
    // v1.7: 记录无命中退出
    if (!session.selected) {
      data.pathfinding_log = data.pathfinding_log || [];
      data.pathfinding_log.push({
        timestamp: new Date().toISOString(),
        session_id: session.id,
        anchor: session.anchor,
        anchor_hash: session.anchor_hash,
        candidates: session.candidates,
        human_selection: null,
        selected_absurd: null,
        condensed_hash: null,
        result: "exited",
      });
      if (data.pathfinding_log.length > 50) data.pathfinding_log = data.pathfinding_log.slice(-50);
    }
    session.selected = null;
    session.condensed = false;
  }
  data.conversation_context.pathfind_session = null;

  return {
    message: "已退出寻路，回到有序追踪模式",
    anchor: data.conversation_context.current_anchor,
  };
}

/**
 * PF-8: 健康警告渲染（供 TOKEN 渲染成自然语言）
 */
function renderHealthWarning(warning) {
  if (!warning) return "";
  return warning.message;
}




module.exports = {
  // H 模块
  generateNodeKey, generateRandomSeed, computeFileHash, generateBatchId,
  pickRandomNodes, computeNgramSimilarity,
  // S 模块
  load, save, getEmptyPool, getStats, migrateToV15,
  // N 模块
  addHumanSeed, addAbsurdVariant, getNode, updateAccess, activateNode,
  connectNodes, rateNode, pruneAbsurdNodes, extractMemory, extractHead,
  // A 模块
  microJump, mesoJump, macroJump,
  generateAbsurdVariants, writeAbsurdVariants,
  // B 模块
  runBatch蔓生,
  // F 模块
  computeFlowIndex, getFlowState, updateFlowRegistry,
  // TRI 模块 v1.6
  computeTriScore, computeNQuality, getTriState, getTriStateLegacy, estimateN,
  computeSwitchCost, updateTriConjugate, getTriDashboard, updateAdaptiveForMode,
  // TRI-THERMO 模块 v1.6
  runChaosThermostat, renderChaosPanel,
  // INDEX 模块 v1.5
  hybridRandomSelect, skiplistRandomWalk, indexAddNode, indexRemoveNode,
  indexCompact, initSkiplist,
  // TRIGGER 模块 v1.5
  detectDeadlockSignals, triggerType1Deadlock, triggerType2Human,
  triggerType3Random, triggerCheckpoint,
  // ADAPTIVE 模块 v1.6
  initPriorParams, collectImplicitFeedback, parseHumanTuneCommand,
  runAdaptiveTuning, applyHumanTune, getAdaptiveSummary,
  // L 模块
  quantumLockExtract, buildExtractionPath, multiPathLock,
  // U 模块
  listAnchors, listAbsurdVariants, getFlowSummary, verifyPoolIntegrity,
  // PATHFIND 模块 v1.7
  updateConversationAnchor, checkReasoningHealth, renderHealthWarning,
  selectAbsurdProbes, renderPathfindPanel,
  runPathfind, recordCondensedNucleus, exitPathfindSession,
};
