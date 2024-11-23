export const PORT = 6969;
export const SERVER_URL = process.env.AIKO_SERVER_URL 
export const SERVER_ENDPOINTS = {
    POST: {
        AI_RESPONSES: `${SERVER_URL}/api/ai-responses`,
        UPDATE_ANIMATION: `${SERVER_URL}/api/update-animation`,
        UPDATE_STREAMING_STATUS: `${SERVER_URL}/api/streaming/status`,
        MARK_COMMENTS_READ: `${SERVER_URL}/api/comments/mark-read`,
        AGENTS_AUDIO: `${SERVER_URL}/api/agents/audio`,
    },
    GET: {
        UNREAD_COMMENTS: (agentId: string) => 
            `${SERVER_URL}/api/streams/${agentId}/unread-comments`
    }
}


export const getAllAnimations = () => {
    return [
        ...ANIMATION_OPTIONS.IDLE,
        ...ANIMATION_OPTIONS.HEAD,
        ...ANIMATION_OPTIONS.GESTURES,
        ...ANIMATION_OPTIONS.DANCING,
        // ...ANIMATION_OPTIONS.SITTING,
        ...ANIMATION_OPTIONS.SPECIAL
        
    ];
}


export const ANIMATION_OPTIONS = {
    // Basic states
    IDLE: [
        "idle",
        "idle-2", 
        "idle_basic", 
        "idle_dwarf",
        "offensive_idle"
    ],

    // Head movements 
    HEAD: [
        "acknowledging",
        "hard_head_nod",
        "head_nod_yes", 
        "lengthy_head_nod",
        "sarcastic_head_nod",
        "shaking_head_no",
        "thoughtful_head_shake",
        "annoyed_head_shake"
    ],

    // Gestures
    GESTURES: [
        "angry_gesture",
        "being_cocky",
        "dismissing_gesture", 
        "happy_hand_gesture",
        "look_away_gesture",
        "relieved_sigh",
        "standing_clap"
    ],

    // Dancing
    DANCING: [
        "dancing_twerk",
        "hip_hop_dancing",
        "rumba_dancing",
        "silly_dancing",
        "capoeira"
    ],

    // Sitting poses
    SITTING: [
        "sitting",
        "sitting_disbelief",
        "sitting_legs_swinging",
        "sitting_yell"
    ],

    // Special actions
    SPECIAL: [
        "appearing",
        "floating", 
        "joyful_jump",
        "laughing",
        "super_excited",
        "walk_with_rifle",
        "weight_shift"
    ]
};
