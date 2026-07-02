# FAQ

## 灰色的拓扑节点是什么？

灰色拓扑节点（Grey Topological Nodes）是 `area_id = -1` 的多面体（polyhedron）中心点。它们在 3D 场景中渲染为灰点（`#666666`），不由任何语义 Area 管辖。

## 为什么这些节点没有归属 Area？

根据实际数据分析，灰色节点无一例外都是 **Gateway Poly（门节点）**——原始数据中 `is_gate: true` 的多面体。

这些多面体位于两个或多个 Area 之间的**过渡区域**（门洞、走廊交叉口、窄通道等），角色是"连接器"而非"房间内部空间"，因此上游管线不将其归类到任何特定 Area。

每个灰色节点还带有 `parent_frontier_id`（唯一的前端体 ID），进一步表明它们来自空间分解中的**边界/前端体**。

约 60% 的灰色节点另带 `is_rollbacked: true` 标记，说明它们曾在分类过程中被回溯撤消过 Area 归属。

## 灰色节点的产生流程

```
原始 3D 地图 → 自由空间凸分解 → 前端体（Frontier）识别 →
Gateway 标记 → 非 Gateway 多面体归类到语义 Area →
area_id = -1 留给 Gateway 多面体 → 写入 scene_graph.json
```

上游管线在分类时显式跳过 Gateway 多面体，保留其 `area_id = -1`。这不是数据处理错误，而是**有意的设计选择**。

## Wall Dilation 是否相关？

Wall Dilation（障碍物膨胀）是上游管线处理步骤之一，用于将障碍物向外膨胀 δ 半径以体现机器人尺寸约束。这个步骤**可能会影响**生成的多面体数量和位置，但**不是**产生灰色节点的直接原因。

灰色节点的分类依据是"是否处于区域间过渡位置"（Gateway），而不是"是否落在膨胀区内"。

## 如何从代码确认？

`frontend/src/lib/scene-loader.ts:78`：

```ts
const aid = p.area_id != null && p.area_id >= 0 ? p.area_id : 0xffffffff;
```

- `area_id >= 0` → 从 `areaColors` 查取该 Area 的颜色
- `area_id < 0` 或 `null` → sentinel `0xffffffff`，颜色回退 `[0.4, 0.4, 0.4]` = `#666666`（灰色）

所有灰色节点共享同一个 Area ID `0xffffffff`，在 `TopologicalNodes.tsx:38` 中作为一组统一渲染。

## 一个典型灰色节点的原始数据

```json
{
  "id": 1,
  "area_id": -1,
  "is_gate": true,
  "is_rollbacked": true,
  "parent_frontier_id": 21,
  "center": [-0.431, -1.346, -6.488],
  "connected_node_ids": [3, 2]
}
```

- `is_gate: true` — 门/过渡节点
- `is_rollbacked: true` — 该节点曾在迭代中被回溯取消归属
- `parent_frontier_id: 21` — 所属前端体 ID
- `connected_node_ids: [3, 2]` — 连接的两个邻接多面体（通常分属不同 Area）

## 实况统计数据

一份实际场景的统计数据（227 个多面体）：

| 类别 | 数量 | 占比 |
|------|------|------|
| 非网关多面体（归属 Area） | 122 | 53.7% |
| 灰色网关多面体（area_id=-1） | 105 | 46.3% |
| 其中 `is_rollbacked=true` | 63 | 60% of gates |

灰色节点占比不低（约 46%），说明这是一条重要数据，而非边缘情况。
