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
    walletAddress?: string;
    sceneConfigs?: SceneConfig[];
    modelName?: string;
    twitter?: string;
    color?: string;
    type?: string;
    avatar?: string;
    creator?: {
        username: string;
        title: string;
        avatar: string;
        description: string;
    };
    stats?: StreamingStats;
}

export interface SceneConfig {
    id?: number;
    name?: string;
    description?: string;
    model: string;
    environmentURL?: string; // required
    defaultAnimation?: string;
    models?: ModelSchema[]; // Assuming ModelSchema is defined elsewhere
    clothes?: string;
    environmentScale?: number[];
    environmentPosition?: number[];
    environmentRotation?: number[];
    cameraPitch?: number;
    cameraPosition?: number[];
    cameraRotation?: number;
}

interface ModelSchema {
    model: string;
    name?: string; // Optional, as it has a default value
    description?: string; // Optional, as it has a default value
    agentId: string; // required
    clothes?: string; // Optional, as it has a default value
    defaultAnimation?: string; // Optional, as it has a default value
    modelPosition?: number[]; // Optional, as it has a default value
    modelRotation?: number[]; // Optional, as it has a default value
    modelScale?: number[]; // Optional, as it has a default value
}

export interface TaskPriority {
    name: string;
    priority: number;
    minInterval: number;
    lastRun?: number;
    isRunning?: boolean;
}
