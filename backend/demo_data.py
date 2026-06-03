"""
后端自带的三看板脱敏演示数据
============================
统一 AI 分析中心在前端不持有各看板的真实数据，因此由后端提供一份
口径一致的脱敏演示数据（综合 / 维修修复率 / 领退料），供 Gemma 4
函数调用循环（agent.py + tools.py）取数。

口径对齐：综合看板与维修修复率看板的修复率均为 81%（已修 13 / 报废 3，
近期闭环 16 单），与前端 computeWipBoard 的结果完全一致。
所有姓名 / 机种 / 料号均为虚构脱敏数据。
"""

# 综合维修看板演示数据（含 WIP 板，修复率 81%）
INTEGRATED = {
    "attendance": {
        "summary": {"dayShiftActual": 12, "nightShiftActual": 8,
                    "attendanceActual": 20, "attendancePlan": 22},
        "present": [
            {"name": "张三", "shift": "白班", "status": "在岗", "group": "维修一组"},
            {"name": "李四", "shift": "白班", "status": "在岗", "group": "维修一组"},
            {"name": "王五", "shift": "夜班", "status": "在岗", "group": "维修二组"},
            {"name": "赵六", "shift": "白班", "status": "在岗", "group": "维修二组"},
        ],
        "absent": [{"name": "钱七", "shift": "白班", "status": "未出勤",
                    "reason": "请假", "group": "维修一组"}],
        "late": [], "leave": [],
    },
    "modules": {
        "module1": {
            "labels": ["05-01", "05-02", "05-03", "05-04", "05-05", "05-06", "05-07"],
            "values": [45, 52, 48, 60, 55, 65, 70],
            "wip": "10",
            "meta": "产线维修趋势 (DEMO)",
        },
        "module3": {
            "labels": ["张三", "李四", "王五", "赵六"],
            "values": [15, 12, 10, 8],
            "meta": "个人产出 (DEMO)",
            "detailMap": {
                "张三": [
                    {"板卡料号": "KSK-100", "错误描述": "自动重启", "数量": 3},
                    {"板卡料号": "ABC-200", "错误描述": "USB无法识别", "数量": 2},
                ],
                "李四": [
                    {"板卡料号": "KSK-100", "错误描述": "自动重启", "数量": 2},
                    {"板卡料号": "XYZ-300", "错误描述": "无显示", "数量": 2},
                ],
                "王五": [
                    {"板卡料号": "ABC-200", "错误描述": "USB无法识别", "数量": 2},
                    {"板卡料号": "DEF-400", "错误描述": "元件虚焊", "数量": 1},
                ],
                "赵六": [
                    {"板卡料号": "KSK-100", "错误描述": "自动重启", "数量": 1},
                    {"板卡料号": "XYZ-300", "错误描述": "无显示", "数量": 1},
                ],
            },
        },
    },
    # WIP 板：待修 28，近期闭环 16 单（已修 13 / 报废 3）→ 修复率 81%
    "wipDemo": {
        "total": 28, "repairRate": 81, "fixed": 13, "scrap": 3,
        "trend": [18, 17, 16, 18, 28],
        "overdue": [
            {"工单": "WO-2001", "机种": "KSK-100", "待修天数": 9, "不良": "自动重启"},
            {"工单": "WO-2002", "机种": "ABC-200", "待修天数": 8, "不良": "USB无法识别"},
        ],
        "byModel": [["KSK-100", 10], ["ABC-200", 8], ["XYZ-300", 6], ["DEF-400", 4]],
        "aging": [[">7天", 2], ["3-7天", 9], ["<3天", 17]],
    },
}

# 维修修复率看板：复用综合看板数据（同一套 WIP / 修复率 81% 口径），分析聚焦修复率
REPAIR = INTEGRATED

# 领退料看板演示数据
MATERIAL = {
    "rows": [
        {"单号": "DEMO-1001", "receive_return_type": "领料", "location_name": "DIP",
         "part": "PN-001", "part_name": "FUSE; 2A; 250V", "create_user_name": "张三"},
        {"单号": "DEMO-1002", "receive_return_type": "退料", "location_name": "SMT",
         "part": "PN-002", "part_name": "RESISTOR; 10K; 0402", "create_user_name": "李四"},
        {"单号": "DEMO-1003", "receive_return_type": "领料", "location_name": "SMT",
         "part": "PN-002", "part_name": "RESISTOR; 10K; 0402", "create_user_name": "李四"},
        {"单号": "DEMO-1004", "receive_return_type": "领料", "location_name": "DIP",
         "part": "PN-003", "part_name": "CAP; 100uF; 16V", "create_user_name": "王五"},
        {"单号": "DEMO-1005", "receive_return_type": "退料", "location_name": "ASM",
         "part": "PN-001", "part_name": "FUSE; 2A; 250V", "create_user_name": "张三"},
        {"单号": "DEMO-1006", "receive_return_type": "领料", "location_name": "DIP",
         "part": "PN-004", "part_name": "IC; MCU; LQFP48", "create_user_name": "赵六"},
    ],
    "overtime": [
        {"单号": "DEMO-1007", "create_user_name": "王五",
         "part": "PN-003", "_overtimeHours": "超时3.5小时"},
    ],
}

DEMO_PAYLOADS = {
    "integrated": INTEGRATED,
    "repair": REPAIR,
    "material": MATERIAL,
}


def get_demo_payload(board: str):
    return DEMO_PAYLOADS.get(board, INTEGRATED)
