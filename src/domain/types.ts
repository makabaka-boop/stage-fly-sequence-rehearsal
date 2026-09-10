/** 吊杆位置：归位 / 舞台位 */
export type Position = 'home' | 'stage';

/** 吊杆设备状态 */
export interface RigState {
  /** 当前载荷：null 表示空载，否则为 1–500 千克 */
  loadKg: number | null;
  position: Position;
  locked: boolean;
  /**
   * 本次装载后是否已完成过「锁定→解锁」。
   * 装载与解锁后的物理状态相同（载重·归位·未锁定），
   * 仅靠物理量无法区分，须用该标记裁决「解锁后才能卸载」。
   */
  unlockedSinceLoad: boolean;
}

/** 口令卡类型：装载 / 锁定 / 移动 / 归位 / 解锁 / 卸载 */
export type CardType = 'load' | 'lock' | 'move' | 'return' | 'unlock' | 'unload';

export interface ActionCard {
  id: string;
  type: CardType;
  /** 仅装载卡携带重量（千克） */
  weightKg?: number;
}

/** 单卡裁决结果：通过 / 首错 / 首错后被跳过 */
export type StepStatus = 'ok' | 'error' | 'skipped';

export interface StepRecord {
  /** 在序列中的下标（从 0 开始） */
  index: number;
  card: ActionCard;
  status: StepStatus;
  /** 执行该卡之前的设备状态 */
  before: RigState;
  /** 执行之后的设备状态（非法或被跳过时与 before 相同） */
  after: RigState;
  /** 非法原因（仅 status 为 error 时存在） */
  reason?: string;
}

export interface Verdict {
  /** 每张卡一条记录，与输入序列一一对应 */
  steps: StepRecord[];
  /** 首张非法卡的下标；全部合法为 null */
  firstErrorIndex: number | null;
  /** 裁决结束时的设备状态（首错即停，即首错发生前一刻的状态） */
  finalState: RigState;
  /** 全部合法且最终回到空载归位 */
  closed: boolean;
}
