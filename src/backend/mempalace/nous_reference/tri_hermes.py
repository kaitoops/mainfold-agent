"""
MemPalace TRI-Hermes 模块
基于 WORKBUDDY Memory Palace v1.7 TRI三方共轭 改造

改造说明：
- 原始: O×C×N (有序度×混沌度×意图清晰度)
- 改造: A×S×H (活跃度×命中率×健康度)
- 适用场景: 多Agent协作记忆系统
"""

import json
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple

class TRIHermes:
    """
    TRI-Hermes: Agent状态协调机制
    
    改造自 WORKBUDDY Memory Palace v1.7 TRI模块
    三维状态: A(活跃度) × S(命中率) × H(健康度)
    """
    
    def __init__(self, core_path: str = "hermes-core.json"):
        self.core_path = Path(core_path)
        self.core_data = self._load_core()
        self.tri = self.core_data.get("tri_hermes", {})
        self.current = self.tri.get("current", {
            "A": 0.5, "S": 0.5, "H": 0.5,
            "tri_score": 0.125, "state": "NORMAL"
        })
        self.thresholds = self.tri.get("thresholds", {
            "A_overload": 0.9, "A_idle": 0.1,
            "S_low": 0.3, "S_optimal": 0.7,
            "H_healthy": 0.8, "H_degraded": 0.6, "H_critical": 0.3
        })
        self.history = self.tri.get("history", [])
    
    def _load_core(self) -> Dict:
        """从 hermes-core.json 加载状态"""
        if self.core_path.exists():
            with open(self.core_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        return {}
    
    def _save_core(self):
        """保存状态到 hermes-core.json"""
        self.core_data["tri_hermes"]["current"] = self.current
        self.core_data["tri_hermes"]["history"] = self.history[-50:]  # 保留最近50条
        with open(self.core_path, 'w', encoding='utf-8') as f:
            json.dump(self.core_data, f, ensure_ascii=False, indent=2)
    
    def compute_tri_score(self) -> float:
        """
        计算 TRI 分数: A × S × H
        
        Returns:
            float: 0.0 ~ 1.0，理想值 0.5 (平衡状态)
        """
        A = self.current["A"]
        S = self.current["S"]
        H = self.current["H"]
        return round(A * S * H, 4)
    
    def update(self, A: Optional[float] = None, S: Optional[float] = None, 
               H: Optional[float] = None) -> Dict:
        """
        更新 TRI 状态
        
        Args:
            A: 活跃度 (0.0 ~ 1.0)
            S: 命中率 (0.0 ~ 1.0)  
            H: 健康度 (0.0 ~ 1.0)
        
        Returns:
            Dict: 状态报告
        """
        if A is not None:
            self.current["A"] = max(0.0, min(1.0, A))
        if S is not None:
            self.current["S"] = max(0.0, min(1.0, S))
        if H is not None:
            self.current["H"] = max(0.0, min(1.0, H))
        
        self.current["tri_score"] = self.compute_tri_score()
        self.current["state"] = self._determine_state()
        self.current["last_update"] = time.strftime("%Y-%m-%dT%H:%M:%S+08:00")
        
        # 记录历史
        self.history.append({
            "timestamp": self.current["last_update"],
            "A": self.current["A"],
            "S": self.current["S"],
            "H": self.current["H"],
            "tri_score": self.current["tri_score"],
            "state": self.current["state"]
        })
        
        self._save_core()
        return self.get_status()
    
    def _determine_state(self) -> str:
        """
        确定系统状态
        
        Returns:
            str: NORMAL | DEGRADED | CRITICAL | OVERLOAD | IDLE
        """
        H = self.current["H"]
        A = self.current["A"]
        S = self.current["S"]
        
        if H < self.thresholds["H_critical"]:
            return "CRITICAL"
        elif H < self.thresholds["H_degraded"]:
            return "DEGRADED"
        elif A > self.thresholds["A_overload"]:
            return "OVERLOAD"
        elif A < self.thresholds["A_idle"]:
            return "IDLE"
        elif S < self.thresholds["S_low"]:
            return "DEGRADED"
        else:
            return "NORMAL"
    
    def get_status(self) -> Dict:
        """获取当前状态"""
        return {
            "A": self.current["A"],
            "S": self.current["S"],
            "H": self.current["H"],
            "tri_score": self.current["tri_score"],
            "state": self.current["state"],
            "last_update": self.current.get("last_update"),
            "thresholds": self.thresholds
        }
    
    def auto_adjust(self, health_ratio: float = 0.15) -> Dict:
        """
        基于 health_ratio 自动调整
        
        Args:
            health_ratio: 健康度比率 (0.0 ~ 1.0)
        
        Returns:
            Dict: 调整报告
        """
        # 将 health_ratio 映射到 H (健康度)
        new_H = health_ratio
        
        # 如果健康度下降，尝试恢复
        if new_H < self.current["H"]:
            recovery_rate = 0.05
            new_H = self.current["H"] * (1 - recovery_rate) + new_H * recovery_rate
        
        return self.update(H=new_H)
    
    def health_check(self) -> Tuple[bool, str]:
        """
        健康检查
        
        Returns:
            Tuple[bool, str]: (是否健康, 状态描述)
        """
        status = self.get_status()
        
        if status["state"] == "CRITICAL":
            return False, f"CRITICAL: H={status['H']:.2f} < {self.thresholds['H_critical']}"
        elif status["state"] == "DEGRADED":
            return False, f"DEGRADED: H={status['H']:.2f} < {self.thresholds['H_degraded']}"
        elif status["state"] == "OVERLOAD":
            return False, f"OVERLOAD: A={status['A']:.2f} > {self.thresholds['A_overload']}"
        elif status["state"] == "IDLE":
            return True, f"IDLE: A={status['A']:.2f} < {self.thresholds['A_idle']}"
        else:
            return True, f"NORMAL: TRI={status['tri_score']:.3f}"


class HealthRatioController:
    """
    Health Ratio 控制器
    改造自 WORKBUDDY chaos_ratio 恒温器
    """
    
    def __init__(self, core_path: str = "hermes-core.json"):
        self.core_path = Path(core_path)
        self.core_data = self._load_core()
        self.control = self.core_data.get("health_ratio_control", {})
        
        self.current = self.control.get("current", 0.15)
        self.auto_range = self.control.get("auto_range", [0.10, 0.20])
        self.auto_step = self.control.get("auto_step", 0.03)
        self.auto_enabled = self.control.get("auto_enabled", True)
        self.signals = self.control.get("signals", {
            "info_decline_count": 0,
            "heartbeat_miss_count": 0,
            "error_count": 0,
            "last_snapshot_turn": 0
        })
        self.thresholds = self.control.get("thresholds", {
            "info_decline_turns": 3,
            "heartbeat_miss": 3,
            "error_spike": 2,
            "snapshot_gap": 6
        })
    
    def _load_core(self) -> Dict:
        if self.core_path.exists():
            with open(self.core_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        return {}
    
    def _save_core(self):
        self.core_data["health_ratio_control"]["current"] = self.current
        self.core_data["health_ratio_control"]["signals"] = self.signals
        with open(self.core_path, 'w', encoding='utf-8') as f:
            json.dump(self.core_data, f, ensure_ascii=False, indent=2)
    
    def signal(self, signal_type: str) -> bool:
        """
        记录信号
        
        Args:
            signal_type: info_decline | heartbeat_miss | error
        
        Returns:
            bool: 是否触发调整
        """
        if signal_type == "info_decline":
            self.signals["info_decline_count"] += 1
            if self.signals["info_decline_count"] >= self.thresholds["info_decline_turns"]:
                return self._adjust(-self.auto_step)
        elif signal_type == "heartbeat_miss":
            self.signals["heartbeat_miss_count"] += 1
            if self.signals["heartbeat_miss_count"] >= self.thresholds["heartbeat_miss"]:
                return self._adjust(-self.auto_step)
        elif signal_type == "error":
            self.signals["error_count"] += 1
            if self.signals["error_count"] >= self.thresholds["error_spike"]:
                return self._adjust(-self.auto_step * 2)
        
        return False
    
    def _adjust(self, delta: float) -> bool:
        """执行调整"""
        if not self.auto_enabled:
            return False
        
        new_value = self.current + delta
        new_value = max(self.auto_range[0], min(self.auto_range[1], new_value))
        
        if new_value != self.current:
            self.current = new_value
            self._save_core()
            return True
        
        return False
    
    def heartbeat(self):
        """心跳信号，重置心跳计数器"""
        self.signals["heartbeat_miss_count"] = 0
    
    def reset_signals(self):
        """重置所有信号"""
        self.signals = {
            "info_decline_count": 0,
            "heartbeat_miss_count": 0,
            "error_count": 0,
            "last_snapshot_turn": 0
        }
        self._save_core()
    
    def get_status(self) -> Dict:
        return {
            "current": self.current,
            "auto_range": self.auto_range,
            "auto_enabled": self.auto_enabled,
            "signals": self.signals
        }


# 快速使用示例
if __name__ == "__main__":
    tri = TRIHermes()
    print("TRI-Hermes 初始化:")
    print(tri.get_status())
    
    # 更新活跃度
    tri.update(A=0.7, S=0.6, H=0.8)
    print("\n更新后状态:")
    print(tri.get_status())
    
    # 健康检查
    healthy, msg = tri.health_check()
    print(f"\n健康检查: {healthy} - {msg}")
