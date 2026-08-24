'use client';

import { useEffect, useRef, useState } from 'react';
import './sample.scss';

type AnimationStyle = { id: number; name: string; className: string };
type QueueItem = { id: string; animation: AnimationStyle };

const animationList: AnimationStyle[] = [
    { id: 0, name: '테두리 애니메이션', className: 'ani-001' },
    { id: 1, name: '텍스트 네온사인', className: 'ani-002' },
];
const RESULTS = [1, 2, 3, 4, 5];
const PLAY_DURATION_MS = 10000;

// crypto.randomUUID()는 보안 컨텍스트(HTTPS/localhost)에서만 지원되므로 HTTP 배포 환경을 위한 폴백
function generateId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function SamplePage() {
    const [nowPlay, setNowPlay] = useState<QueueItem | null>(null);
    const [playQueue, setPlayQueue] = useState<QueueItem[]>([]);
    const [selectStyle, setSelectStyle] = useState<AnimationStyle>(animationList[0]);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (nowPlay || playQueue.length === 0) return;
        const [next, ...rest] = playQueue;
        setNowPlay(next);
        setPlayQueue(rest);
    }, [nowPlay, playQueue]);

    useEffect(() => {
        if (!nowPlay) return;
        timerRef.current = setTimeout(() => setNowPlay(null), PLAY_DURATION_MS);
        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, [nowPlay]);

    const sendDonation = () => {
        setPlayQueue((queue) => [...queue, {
            id: generateId(),
            animation: selectStyle,
        }]);
    };

    return (
        <div className="sample-page">
            <div className="overlay-frame">
                <div className={`top-area ${nowPlay ? 'active' : ''}`}>
                    <div className="left sample-card"></div>
                    <div className="right sample-card"></div>
                </div>
                <div className={`bottom-area ${nowPlay ? 'active' : ''}`}>
                    <div className="sample-card"></div>
                </div>

                <div className="content">
                    <div className={`random-box ${nowPlay ? 'active' : ''}`}>
                        <div className="card-track">
                            {RESULTS.map((number, index) => (
                                <div className={`result-card n${index + 1}`} key={number}>
                                    <div className="card-scale">
                                        <div className="card-flipper">
                                            <div className="card-face card-front" aria-hidden="true">?</div>
                                            <div className="card-face card-back">{number}</div>
                                        </div>
                                    </div>
                                    {Array.from({ length: 2 }, (_, groupIndex) => (
                                        <div
                                            className={`sparkles sparkle-group-${groupIndex + 1}`}
                                            aria-hidden="true"
                                            key={groupIndex}
                                        >
                                            {Array.from({ length: 30 }, (_, sparkleIndex) => (
                                                <i key={sparkleIndex} />
                                            ))}
                                        </div>
                                    ))}
                                </div>
                            ))}
                        </div>
                    </div>
                    {nowPlay && 
                    <div className={`animation-box ${nowPlay.animation.className}`}>
                        {
                            nowPlay.animation.id === 1 && 
                            <div className='neon'>
                                <div className='top'>
                                    <span>큰손</span>
                                    <span>왔다</span>
                                </div>
                                
                                <div className="neon-text yellow-neon">
                                    VIP
                                </div>
                                <div className="neon-text white-neon">
                                    게스트
                                </div>
                                <div className="neon-text yellow-neon">
                                    555,555
                                </div>
                                <div className="neon-text white-neon">
                                    스트
                                </div>
                            </div>
                        }
                    </div>
                    }
                </div>
            </div>

            <div className="sample-console">
                <select
                    value={selectStyle.id}
                    onChange={(event) => setSelectStyle(
                        animationList.find((item) => item.id === Number(event.target.value))
                        ?? animationList[0],
                    )}
                >
                    {animationList.map((item) => (
                        <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                </select>
                <p className="queue-status">
                    대기열 {playQueue.length}개{nowPlay ? ' · 재생 중' : ''}
                </p>
                <button className="send-button" type="button" onClick={sendDonation}>
                    후원 전송
                </button>
            </div>
        </div>
    );
}
