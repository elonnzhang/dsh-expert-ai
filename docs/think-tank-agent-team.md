# “智囊团”Agent Team 设计方案

## 1. 产品定位

“智囊团”是由多个数字生命组成的任务型协作团队。它不是让多个 Agent 无序聊天，而是围绕一个目标，按照明确角色、任务边界、交接协议和决策规则协同产出结果。

核心价值：

- 根据任务自动选择合适的数字生命；
- 通过角色互补减少单一 Agent 的偏差；
- 并行研究和执行，提高复杂任务效率；
- 保留证据、分歧和责任链，使结论可追溯；
- 通过模板复用成熟的团队组织方式。

## 2. 数字生命元数据分层

### 2.1 当前落地字段

```ts
interface ExpertRecord {
  id: string;
  name: string;
  description: string;
  category: ExpertCategory;
  customCategory?: string;
  tags: string[];
  persona: string;
  enabled: boolean;
}
```

字段语义：

| 字段 | 含义 | 智囊团用途 |
|---|---|---|
| `id` | 稳定身份标识 | 引用成员、保存团队配置 |
| `name` | 展示名称 | UI 与报告署名 |
| `description` | 一句话职责 | 候选解释和人工选人 |
| `category` | 稳定主领域 | 粗粒度召回、分组和统计 |
| `customCategory` | 自定义主领域 | 补充标准领域词表 |
| `tags` | 可组合特征 | 搜索、软匹配、团队互补 |
| `persona` | 思考与表达规则 | 实际执行风格和身份约束 |

### 2.2 后续应独立增加的字段

不要将所有信息继续塞入 `tags`。后续分层增加：

```ts
interface ExpertTeamProfile {
  capabilities: Capability[];
  teamRoles: TeamRoleId[];
  constraints?: AgentConstraints;
  interfaces?: string[];
  lifecycle?: "experimental" | "stable" | "deprecated";
}
```

- `capabilities`：可验证的任务能力，是自动路由硬条件；
- `teamRoles`：可承担的协作位置；
- `constraints`：权限、审批、成本、并发等限制；
- `interfaces`：可接受和产出的结构化协议；
- `lifecycle`：是否适合进入正式团队。

## 3. Category 与 Tags 的使用规则

### 3.1 主领域 Category

主领域回答“这个数字生命主要负责哪一类工作”。它应该：

- 单选；
- 数量少；
- 相对稳定；
- 用于候选召回和管理分组；
- 不直接证明某项能力。

当前领域可以继续从现有词表演进：

```text
business
science
culture
custom
```

后续建议逐步调整为职责导向词表：

```text
general
research
product
engineering
content
operations
coordination
custom
```

迁移时应保留旧值兼容，不应直接修改已有记录的语义。

### 3.2 能力标签 Tags

标签回答“它具有什么可组合特征”。第一阶段采用字符串数组：

```json
["市场研究", "B2B", "证据导向", "审查"]
```

用途：

- `@` 候选搜索；
- 设置列表快速识别；
- 智囊团候选软排序；
- 提示为什么选择某个成员；
- 增加团队风格和领域多样性。

标签当前不应用于：

- 授予工具或数据权限；
- 声明可靠的专业能力；
- 表示实时可用性；
- 表示可比较的成本、延迟和成功率。

未来可兼容升级为命名空间标签：

```ts
type Tag = string | {
  namespace: "domain" | "style" | "collaboration";
  value: string;
  source?: "user" | "system" | "observed";
};
```

## 4. 智囊团核心数据模型

```ts
interface ThinkTank {
  id: string;
  name: string;
  purpose: string;
  mode: "fixed" | "dynamic";
  roles: ThinkTankRole[];
  workflow: ThinkTankWorkflow;
  decisionPolicy: DecisionPolicy;
  constraints?: TeamConstraints;
}

interface ThinkTankRole {
  id: string;
  label: string;
  required: boolean;
  count?: number;
  memberIds?: string[];
  preferredCategories?: ExpertCategory[];
  requiredCapabilities?: string[];
  preferredTags?: string[];
  excludedTags?: string[];
  inputProtocol: string;
  outputProtocol: string;
}
```

团队支持两种模式：

- `fixed`：用户明确指定每个角色对应的数字生命；
- `dynamic`：系统运行时根据角色条件自动选择成员。

第一版建议先做固定团队，结构中保留动态选择条件。

## 5. 标准团队角色

建议提供少量标准角色，不把角色固化为数字生命的类别：

| 角色 | 职责 |
|---|---|
| `coordinator` | 理解目标、拆解任务、调度成员、维护进度 |
| `researcher` | 收集信息、证据、案例和未知变量 |
| `proposer` | 提出方案、假设或候选决策 |
| `critic` | 寻找反例、漏洞、隐含假设和风险 |
| `builder` | 编写代码、文档、模型或可执行方案 |
| `reviewer` | 按验收标准检查事实、质量和完整性 |
| `synthesizer` | 合并多方结果，保留共识与分歧 |
| `decision-maker` | 根据规则形成最终建议或请求人工决策 |

同一数字生命可以在不同智囊团中承担不同角色。

## 6. 组队与路由策略

自动选人采用四阶段流程：

1. **主领域召回**：用 `category` 找到大类候选；
2. **能力硬筛选**：验证 `requiredCapabilities`；
3. **标签软排序**：按领域、风格和协作标签排序；
4. **约束校验**：检查权限、审批、预算、并发和可用性。

示例评分：

```text
eligible(agent) =
  agent.enabled
  AND requiredCapabilities ⊆ verifiedCapabilities
  AND constraintsSatisfied(agent)

score(agent) =
  categoryMatch * 20
  + capabilityScore * 50
  + preferredTagMatches * 5
  + historicalSuccess * 20
  - costPenalty
  - conflictPenalty
```

系统必须展示选择原因，例如：

> 选择“科研顾问”担任审查者：主领域为 research，具备 fact-checking 能力，匹配“证据导向”和“审查”标签。

## 7. 协作工作流

推荐默认工作流：

```text
用户目标
  ↓
Coordinator：拆解任务与验收标准
  ↓
Researchers / Builders：并行执行
  ↓
Critic：独立挑战结论
  ↓
Reviewer：检查事实、证据和完整性
  ↓
Synthesizer：汇总共识、分歧与建议
  ↓
人工确认或自动完成
```

第一版不应允许 Agent 自由无限互聊。每个阶段应有：

- 明确输入；
- 明确输出格式；
- 最大轮次；
- 超时；
- 失败与重试规则；
- 是否需要人工审批。

## 8. 结构化交接协议

### 8.1 Research Note

```ts
interface ResearchNote {
  claims: Array<{
    statement: string;
    evidence: string[];
    confidence: "low" | "medium" | "high";
  }>;
  assumptions: string[];
  unknowns: string[];
  sources: string[];
}
```

### 8.2 Critique Report

```ts
interface CritiqueReport {
  risks: string[];
  counterExamples: string[];
  unsupportedClaims: string[];
  suggestedTests: string[];
}
```

### 8.3 Final Brief

```ts
interface FinalBrief {
  summary: string;
  recommendation: string;
  alternatives: string[];
  consensus: string[];
  disagreements: string[];
  risks: string[];
  nextActions: string[];
  provenance: Array<{ agentId: string; artifactId: string }>;
}
```

结构化产物是可靠协作的基础；标签只负责找到合适的人，不能替代交接协议。

## 9. 决策规则

支持以下策略：

- `coordinator-final`：协调者综合后决定；
- `reviewer-gate`：必须通过审查者验收；
- `consensus`：成员一致或达到阈值；
- `majority`：多数意见，但保留少数报告；
- `human-final`：智囊团只给建议，由用户最终决定。

默认建议使用 `human-final`，尤其是涉及外部发布、资金、法律、医疗和不可逆操作时。

## 10. 产品界面建议

### 10.1 智囊团列表

展示：

- 名称和目的；
- 成员数量；
- 角色覆盖；
- 固定/动态模式；
- 最近运行结果；
- 启用状态。

### 10.2 智囊团编辑器

分三步：

1. 填写名称、目的、默认工作流；
2. 配置角色及成员；
3. 配置决策、预算、审批和最大轮次。

### 10.3 运行视图

显示任务图，而不是普通群聊：

```text
任务拆解 → 3 个并行研究 → 批评 → 审查 → 汇总
```

每个节点显示负责人、状态、产物、耗时、成本和错误。

## 11. 分阶段实施路线

### Phase 1：基础元数据（当前）

- `category` 明确为主领域；
- `tag` 迁移为 `tags[]`；
- 搜索和 UI 使用 tags；
- custom 主领域要求填写具体名称。

### Phase 2：固定智囊团

- 创建智囊团配置；
- 用户手动为标准角色选择成员；
- 支持并行咨询、批评、审查和汇总；
- 使用结构化交接产物；
- 支持最大轮次和人工最终确认。

### Phase 3：能力驱动动态组队

- 增加 `capabilities` 和 `teamRoles`；
- 自动生成候选成员和选择解释；
- 加入约束、工具和权限校验；
- 支持不可用成员替换。

### Phase 4：评测与自适应

- 记录成功率、返工率、耗时和成本；
- 自动推荐标签，但需人工确认；
- 按历史任务结果优化路由；
- 支持团队模板评测和版本管理。

## 12. MVP 验收标准

固定智囊团 MVP 应满足：

1. 用户能创建一个包含至少 3 个角色的智囊团；
2. 同一任务可以并行咨询多个成员；
3. 批评者不能直接覆盖原始结果，必须生成独立报告；
4. 汇总结果保留共识、分歧、风险和来源；
5. 用户能看到每一步由谁完成以及失败原因；
6. 停止任务后不再产生新调用；
7. 高风险外部动作必须由用户确认；
8. 团队配置和运行记录可复用、可追溯。

## 13. 设计原则

- 类别负责“主要属于什么”；
- 标签负责“具有什么特征”；
- 能力负责“经过验证能做什么”；
- 角色负责“这次团队中承担什么”；
- 约束负责“允许在什么条件下做”；
- 协议负责“成员之间如何可靠交接”；
- 运行指标负责“实际表现如何”；
- 人格负责“如何思考、表达和保持身份”。

“智囊团”的核心不是 Agent 数量，而是角色互补、边界清楚、交接可靠、决策可追溯。
