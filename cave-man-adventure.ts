/**
 * CAVE MAN — 文本冒险游戏
 * 一个基于洞穴探险的交互式文字冒险
 * 玩家探索洞穴、收集工具、解开谜题
 */

interface Room {
  id: string;
  name: string;
  description: string;
  exits: Record<string, string>;
  items: string[];
  descriptionSeen: boolean;
}

interface GameState {
  currentRoom: string;
  inventory: string[];
  visited: Set<string>;
  gameOver: boolean;
  message: string;
  turns: number;
  score: number;
}

class CaveManAdventure {
  private rooms: Map<string, Room>;
  private state: GameState;

  constructor() {
    this.rooms = new Map();
    this.state = {
      currentRoom: 'cave_entrance',
      inventory: [],
      visited: new Set(),
      gameOver: false,
      message: '',
      turns: 0,
      score: 0
    };
    this.setupRooms();
  }

  private setupRooms(): void {
    const roomData: Room[] = [
      {
        id: 'cave_entrance',
        name: '🏔️ 洞穴入口',
        description: `你站在一个巨大的石灰岩洞穴入口前。\n潮湿的空气中弥漫着矿物的气息。\n洞口上方刻着古老的符号：「CAVE MAN — 只带勇气者入」\n\n你可以看到：\n- 东边：一条阴暗的隧道延伸入黑暗\n- 脚下：一块松动的地砖`,
        exits: { east: 'dark_tunnel' },
        items: ['手电筒（电量50%）', '松动的石头'],
        descriptionSeen: false
      },
      {
        id: 'dark_tunnel',
        name: '🌑 黑暗隧道',
        description: `隧道很狭窄，墙壁湿滑。\n远处传来滴水声...滴...答...\n\n如果你有手电筒，也许能看清更多细节。`,
        exits: { west: 'cave_entrance', south: 'crystal_chamber' },
        items: [],
        descriptionSeen: false
      },
      {
        id: 'crystal_chamber',
        name: '💎 水晶厅',
        description: `你进入了一个令人窒息的美丽空间！\n墙壁上覆盖着发光的紫色水晶，\n它们发出微弱的蓝光，照亮了整个洞穴。\n\n房间中央有一个石台，上面放着什么东西。`,
        exits: { north: 'dark_tunnel', east: 'underground_lake' },
        items: ['古老钥匙', '水晶碎片'],
        descriptionSeen: false
      },
      {
        id: 'underground_lake',
        name: '🌊 地下湖',
        description: `一个宁静的地下湖展现在你面前。\n湖水清澈见底，可以看到湖底有东西在发光。\n湖面上飘着一艘小木船。`,
        exits: { west: 'crystal_chamber', north: 'treasure_room' },
        items: ['船桨', '发光的宝石'],
        descriptionSeen: false
      },
      {
        id: 'treasure_room',
        name: '👑 宝藏室',
        description: `你找到了传说中的宝藏室！\n金币、珠宝、古老文物堆满了整个房间。\n\n但房间中央的石棺上刻着一行字：\n「放下一样你最珍视的东西，才能带走真正的宝藏」`,
        exits: { south: 'underground_lake' },
        items: ['古代王冠', '金币袋', '神秘卷轴'],
        descriptionSeen: false
      }
    ];

    roomData.forEach(room => this.rooms.set(room.id, room));
  }

  public processCommand(input: string): string {
    if (this.state.gameOver) {
      return '游戏已结束。输入 restart 重新开始。';
    }

    this.state.turns++;
    const cmd = input.toLowerCase().trim();
    const parts = cmd.split(/\s+/);
    const action = parts[0];
    const target = parts.slice(1).join(' ');

    switch (action) {
      case 'go':
      case 'move':
      case '走':
      case '去':
        return this.move(target || parts[1] || '');
      
      case 'look':
      case '看':
      case '观察':
        return this.look();
      
      case 'take':
      case '拿':
      case '捡':
      case '拾取':
        return this.take(target);
      
      case 'inventory':
      case '背包':
      case 'i':
        return this.showInventory();
      
      case 'use':
      case '使用':
      case '用':
        return this.useItem(target);
      
      case 'help':
      case '帮助':
        return this.showHelp();
      
      case 'status':
      case '状态':
        return this.showStatus();
      
      case 'restart':
      case '重新开始':
        this.reset();
        return '🔄 游戏已重新开始！\n\n' + this.look();
      
      case 'examine':
      case '检查':
      case '查看':
        return this.examineItem(target);
      
      default:
        return `❌ 我不理解「${input}」。试试：go/look/take/use/inventory/help`;
    }
  }

  private move(direction: string): string {
    const current = this.rooms.get(this.state.currentRoom)!;
    const dirMap: Record<string, string> = {
      'north': 'north', 'n': 'north',
      'south': 'south', 's': 'south',
      'east': 'east', 'e': 'east',
      'west': 'west', 'w': 'west',
      '北': 'north', '南': 'south', '东': 'east', '西': 'west'
    };

    const normalizedDir = dirMap[direction];
    if (!normalizedDir || !current.exits[normalizedDir]) {
      return '❌ 那里没有路。';
    }

    const nextRoomId = current.exits[normalizedDir];
    this.state.currentRoom = nextRoomId;
    this.state.visited.add(nextRoomId);
    
    const room = this.rooms.get(nextRoomId)!;
    if (!room.descriptionSeen) {
      room.descriptionSeen = true;
      return room.description;
    }
    return `你来到了${room.name}。\n${room.description.split('\n')[0]}`;
  }

  private look(): string {
    const room = this.rooms.get(this.state.currentRoom)!;
    let output = `📍 ${room.name}\n\n${room.description}\n`;
    
    if (room.items.length > 0) {
      output += `\n📦 地上的物品：${room.items.join('、')}\n`;
    }
    
    const exits = Object.keys(room.exits);
    if (exits.length > 0) {
      const exitNames: Record<string, string> = {
        north: '北', south: '南', east: '东', west: '西'
      };
      output += `\n🚪 出口：${exits.map(e => exitNames[e] || e).join('、')}`;
    }

    return output;
  }

  private take(itemName: string): string {
    if (!itemName) return '❌ 你想拿什么？';
    
    const room = this.rooms.get(this.state.currentRoom)!;
    const matchedItem = room.items.find(i => i.includes(itemName));
    
    if (!matchedItem) {
      return `❌ 这里没有「${itemName}」。`;
    }
    
    room.items = room.items.filter(i => i !== matchedItem);
    this.state.inventory.push(matchedItem);
    this.state.score += 10;
    return `✅ 你拿起了 ${matchedItem}！`;
  }

  private useItem(target: string): string {
    if (!target) return '❌ 你想用什么？';
    
    const matchedItem = this.state.inventory.find(i => i.includes(target));
    if (!matchedItem) {
      return `❌ 你身上没有「${target}」。`;
    }

    // Special interactions
    if (matchedItem.includes('钥匙') && this.state.currentRoom === 'treasure_room') {
      this.state.score += 100;
      this.state.gameOver = true;
      return `🏆 你用古老钥匙打开了石棺！\n\n里面是传说中的「CAVE MAN 之石」——\n一块能让人获得远古智慧和勇气的水晶！\n\n🎉 恭喜你完成了 CAVE MAN 冒险！\n最终得分：${this.state.score} 分（${this.state.turns} 步）`;
    }

    if (matchedItem.includes('手电筒')) {
      if (this.state.currentRoom === 'dark_tunnel') {
        this.state.score += 20;
        return '💡 你打开手电筒，照亮了隧道！\n你发现墙上刻着一行小字：「继续向南，宝藏等你。」';
      }
      return '💡 手电筒亮了，但这里不需要。';
    }

    return `❌ 现在用不了「${matchedItem}」。`;
  }

  private examineItem(target: string): string {
    if (!target) return '❌ 你想检查什么？';
    
    const room = this.rooms.get(this.state.currentRoom)!;
    const roomItem = room.items.find(i => i.includes(target));
    
    if (roomItem) {
      if (roomItem.includes('石头')) {
        return '一块看起来很普通的石头，但底部有奇怪的标记。';
      }
      return `你仔细检查了${roomItem}，它看起来很有价值。`;
    }
    
    const invItem = this.state.inventory.find(i => i.includes(target));
    if (invItem) {
      return `你从背包里拿出${invItem}仔细查看。${invItem.includes('卷轴') ? '上面写满了古老文字，你认出了几个字：「钥匙...宝藏...放下...」' : '它看起来完好无损。'}`;
    }
    
    return `❌ 没有找到「${target}」。`;
  }

  private showInventory(): string {
    if (this.state.inventory.length === 0) {
      return '🎒 你的背包是空的。';
    }
    return `🎒 背包：\n${this.state.inventory.map((item, i) => `${i+1}. ${item}`).join('\n')}`;
  }

  private showHelp(): string {
    return `📖 CAVE MAN 命令指南：
━━━━━━━━━━━━━━━━
go/走 + 方向  — 移动（north/south/east/west/北/南/东/西）
look/看       — 观察当前房间
take/拿 + 物品 — 拾取物品
use/使用 + 物品 — 使用物品
examine/检查 + 物品 — 详细查看
inventory/背包 — 查看背包
status/状态   — 查看游戏状态
help/帮助     — 显示此帮助
restart       — 重新开始游戏`;
  }

  private showStatus(): string {
    return `📊 CAVE MAN 状态：
━━━━━━━━━━━━━━
📍 位置：${this.rooms.get(this.state.currentRoom)?.name}
🎒 物品：${this.state.inventory.length} 件
👣 步数：${this.state.turns}
⭐ 得分：${this.state.score}
🏠 探索：${this.state.visited.size}/${this.rooms.size} 房间`;
  }

  private reset(): void {
    this.state = {
      currentRoom: 'cave_entrance',
      inventory: [],
      visited: new Set(),
      gameOver: false,
      message: '',
      turns: 0,
      score: 0
    };
    this.rooms.clear();
    this.setupRooms();
  }

  public getInitialDisplay(): string {
    this.state.visited.add('cave_entrance');
    const entrance = this.rooms.get('cave_entrance')!;
    entrance.descriptionSeen = true;
    return `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🦴  CAVE MAN  洞穴探险  v1.0  🦴
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${entrance.description}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
输入 help 查看命令清单
祝你好运，勇敢的 Cave Man！
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
  }

  public getState(): GameState {
    return { ...this.state, visited: new Set(this.state.visited) };
  }
}

// Interactive REPL (if run directly)
const adventure = new CaveManAdventure();
console.log(adventure.getInitialDisplay());

// Export for HARNESS integration
export { CaveManAdventure, Room, GameState };

// Readline interface for interactive play
if (process.stdin.isTTY) {
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '\n> '
  });

  rl.prompt();

  rl.on('line', (line: string) => {
    const result = adventure.processCommand(line.trim());
    console.log('\n' + result);
    rl.prompt();
  }).on('close', () => {
    console.log('\n👋 感谢游玩 CAVE MAN！再见！');
    process.exit(0);
  });
}
