export interface AIResponse {
    // Required
    id: string;
    text: string;
    agentId: string;

    // Optional reply fields
    replyToUser?: string;
    replyToMessageId?: string;
    replyToMessage?: string;
    replyToPfp?: string;
    replyToHandle?: string;
    
    // Optional metadata
    intensity?: number;
    thought?: boolean;
    
    // Gift-specific fields
    isGiftResponse?: boolean;
    giftId?: string;

    isTopLikerResponse?: boolean;

    animation?: string;

    audioUrl?: string;
    
    // Any additional fields
    [key: string]: any;
} 


export interface StreamingStats {
    likes?: number;
    comments?: number;
    [key: string]: any;
}

export interface StreamingStatusUpdate {
    agentId: string;
    isStreaming?: boolean;
    title?: string;
    description?: string;
    model?: string;
    modelName?: string;
    twitter?: string;
    color?: string;
    type?: string;
    avatar?: string;
    creator?: {
        username: string;
        title: string;
        avatar: string;
    };
    stats?: StreamingStats;
}

export interface TaskPriority {
    name: string;
    priority: number;
    minInterval: number;
    lastRun?: number;
    isRunning?: boolean;
}
