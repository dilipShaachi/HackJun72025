import React, { useRef, useEffect, useState } from 'react';
import './App.css';
import * as tf from '@tensorflow/tfjs';
import * as cocoSsd from '@tensorflow-models/coco-ssd';

function App() {
  const videoRef = useRef(null);
  const [model, setModel] = useState(null);
  const [detections, setDetections] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModelLoaded, setIsModelLoaded] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const [cameraStatus, setCameraStatus] = useState('requesting');
  const [detectionCount, setDetectionCount] = useState(0);
  const [lastVoiceAnnouncement, setLastVoiceAnnouncement] = useState({});
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);

  // Initialize voice support and detect mobile
  useEffect(() => {
    // Detect if we're on mobile
    const checkMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    setIsMobile(checkMobile);
    
    // Check if speech synthesis is supported
    if ('speechSynthesis' in window) {
      setSpeechSupported(true);
      console.log('Speech synthesis supported, Mobile:', checkMobile);
      
      // For mobile devices, we need a more aggressive approach
      const enableVoiceOnInteraction = async () => {
        if (!voiceEnabled) {
          try {
            // Stop any existing speech
            speechSynthesis.cancel();
            
            // Wait a bit for the cancel to complete
            setTimeout(() => {
              // Create a test utterance to "wake up" the speech engine
              const testUtterance = new SpeechSynthesisUtterance('Voice enabled');
              testUtterance.volume = 0.1;
              testUtterance.rate = 1;
              testUtterance.lang = 'en-US';
              
              testUtterance.onstart = () => {
                console.log('Voice test started - voice enabled!');
                setVoiceEnabled(true);
              };
              
              testUtterance.onerror = (e) => {
                console.error('Voice test failed:', e);
                setVoiceEnabled(false);
              };
              
              testUtterance.onend = () => {
                console.log('Voice test completed');
              };
              
              speechSynthesis.speak(testUtterance);
            }, 100);
            
          } catch (error) {
            console.error('Voice initialization error:', error);
          }
        }
      };

      // Add event listeners for user interaction
      const events = ['touchstart', 'touchend', 'click', 'keydown'];
      events.forEach(event => {
        document.addEventListener(event, enableVoiceOnInteraction, { once: true });
      });

      return () => {
        events.forEach(event => {
          document.removeEventListener(event, enableVoiceOnInteraction);
        });
      };
    } else {
      console.log('Speech synthesis not supported');
      setSpeechSupported(false);
    }
  }, [voiceEnabled]);

  // Show notification (fallback for when voice doesn't work)
  const showNotification = (message) => {
    const notification = {
      id: Date.now(),
      message,
      timestamp: Date.now()
    };
    
    setNotifications(prev => [...prev, notification]);
    
    // Remove notification after 3 seconds
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== notification.id));
    }, 3000);
  };

  // Enhanced voice announcement with iOS-specific handling and fallback
  const announceDetection = (objectClass, confidence) => {
    try {
      const now = Date.now();
      const lastAnnounced = lastVoiceAnnouncement[objectClass] || 0;
      const cooldownPeriod = 30000; // 30 seconds

      // Only announce if 30 seconds have passed since last announcement for this object
      if (now - lastAnnounced > cooldownPeriod) {
        const message = `${objectClass} detected with ${confidence} percent confidence`;
        
        // Update last announcement time first
        setLastVoiceAnnouncement(prev => ({
          ...prev,
          [objectClass]: now
        }));
        
        // Try voice first
        if (speechSupported && voiceEnabled) {
          try {
            // Cancel any existing speech
            speechSynthesis.cancel();
            
            setTimeout(() => {
              const utterance = new SpeechSynthesisUtterance(message);
              utterance.rate = 0.7; // Slower for mobile
              utterance.pitch = 1.0;
              utterance.volume = 1.0;
              utterance.lang = 'en-US';
              
              utterance.onstart = () => {
                console.log(`🔊 Voice started: ${message}`);
              };
              
              utterance.onerror = (event) => {
                console.error('Speech synthesis error:', event.error);
                // Fallback to notification
                showNotification(`🎯 ${objectClass.toUpperCase()} detected (${confidence}%)`);
              };
              
              utterance.onend = () => {
                console.log('🔊 Voice announcement completed');
              };

              speechSynthesis.speak(utterance);
            }, 200); // Small delay for iOS
            
          } catch (speechError) {
            console.error('Speech error:', speechError);
            // Fallback to notification
            showNotification(`🎯 ${objectClass.toUpperCase()} detected (${confidence}%)`);
          }
        } else {
          // Voice not available, show notification
          console.log(`🔇 Voice not available, showing notification: ${message}`);
          showNotification(`🎯 ${objectClass.toUpperCase()} detected (${confidence}%)`);
        }
        
        console.log(`🔊 Detection announcement: ${message}`);
      } else {
        const timeLeft = Math.round((cooldownPeriod - (now - lastAnnounced)) / 1000);
        console.log(`🔇 Announcement cooldown: ${objectClass} - ${timeLeft}s remaining`);
      }
    } catch (error) {
      console.error('Announcement error:', error);
    }
  };

  // Manual detection trigger for testing
  const runManualDetection = async () => {
    if (!model || !videoRef.current) {
      console.log('Cannot run manual detection - missing model or video');
      return;
    }
    
    try {
      console.log('=== MANUAL DETECTION TRIGGERED ===');
      const video = videoRef.current;
      console.log('Video state:', {
        readyState: video.readyState,
        dimensions: `${video.videoWidth}x${video.videoHeight}`,
        playing: !video.paused,
        currentTime: video.currentTime
      });
      
      const predictions = await model.detect(video);
      console.log('Manual detection results:', predictions);
      setDetectionCount(prev => prev + 1);
      
      // Test with all objects, not just person/chair
      if (predictions.length > 0) {
        console.log('🎉 OBJECTS DETECTED:', predictions.map(p => `${p.class} (${Math.round(p.score * 100)}%)`));
        
        // Filter for chairs and persons only
        const relevantDetections = predictions.filter(prediction => 
          prediction.class === 'person' || prediction.class === 'chair'
        );
        
        setDetections(relevantDetections);
        
        // Voice announcements for detected objects
        if (relevantDetections.length > 0) {
          relevantDetections.forEach(detection => {
            announceDetection(detection.class, Math.round(detection.score * 100));
          });
        }
      }
      
    } catch (error) {
      console.error('Manual detection error:', error);
    }
  };

  // Manual voice test
  const testVoice = () => {
    console.log('=== MANUAL VOICE TEST ===');
    announceDetection('person', 85);
  };

  // Initialize camera and model
  useEffect(() => {
    const initializeApp = async () => {
      try {
        // Configure TensorFlow.js backend for better compatibility
        await tf.ready();
        console.log('TensorFlow.js backend:', tf.getBackend());
        
        // Force CPU backend if WebGL fails
        if (tf.getBackend() === 'webgl') {
          console.log('Using WebGL backend');
        } else {
          console.log('WebGL not available, using CPU backend');
          await tf.setBackend('cpu');
        }
        
        // Load TensorFlow.js model
        console.log('Loading COCO-SSD model...');
        const loadedModel = await cocoSsd.load();
        setModel(loadedModel);
        setIsModelLoaded(true);
        console.log('Model loaded successfully!');

        // Get camera access - optimized for mobile devices
        try {
          const constraints = {
            video: { 
              width: { ideal: 1280, min: 320 }, 
              height: { ideal: 720, min: 240 },
              facingMode: 'environment', // Back camera for mobile, better for object detection
              frameRate: { ideal: 30, min: 15 }
            }
          };

          // Try back camera first, then front camera
          let stream;
          try {
            stream = await navigator.mediaDevices.getUserMedia(constraints);
          } catch (backCameraError) {
            console.log('Back camera failed, trying front camera');
            constraints.video.facingMode = 'user';
            stream = await navigator.mediaDevices.getUserMedia(constraints);
          }
          
          setCameraStatus('connected');
          
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            await videoRef.current.play();
            console.log('Camera connected successfully!');
          }
        } catch (cameraError) {
          console.error('Camera error:', cameraError);
          setCameraError(cameraError.message);
          setCameraStatus('error');
          
          // If camera fails, create a test canvas for demo
          createTestCanvas();
        }
        
        setIsLoading(false);
      } catch (error) {
        console.error('Error initializing app:', error);
        setCameraError(error.message);
        setCameraStatus('error');
        setIsLoading(false);
      }
    };

    // Create test canvas when camera isn't available
    const createTestCanvas = () => {
      if (videoRef.current) {
        const canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 480;
        const ctx = canvas.getContext('2d');
        
        // Draw test scene
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, 640, 480);
        
        // Draw person rectangle
        ctx.fillStyle = '#ff6b6b';
        ctx.fillRect(200, 150, 80, 200);
        ctx.fillStyle = 'white';
        ctx.font = '14px Arial';
        ctx.fillText('Test Person', 210, 140);
        
        // Draw chair rectangle  
        ctx.fillStyle = '#4ecdc4';
        ctx.fillRect(350, 250, 100, 80);
        ctx.fillText('Test Chair', 360, 240);
        
        // Convert canvas to video stream
        const stream = canvas.captureStream(30);
        videoRef.current.srcObject = stream;
        videoRef.current.play();
        console.log('Using test canvas for demo');
      }
    };

    initializeApp();
  }, []);

  // Object detection loop with better dependency management and error handling
  useEffect(() => {
    console.log('Detection effect triggered:', { model: !!model, video: !!videoRef.current, isLoading });
    
    if (!model) {
      console.log('No model available yet');
      return;
    }
    
    if (!videoRef.current) {
      console.log('No video element available yet');
      return;
    }

    if (isLoading) {
      console.log('Still loading, waiting...');
      return;
    }

    console.log('Starting detection interval...');

    const detectObjects = async () => {
      try {
        const video = videoRef.current;
        
        if (!video) {
          console.log('Video ref lost');
          return;
        }
        
        // Enhanced video readiness check
        if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
          console.log('Running detection...', { 
            readyState: video.readyState, 
            dimensions: `${video.videoWidth}x${video.videoHeight}`,
            backend: tf.getBackend()
          });
          
          const predictions = await model.detect(video);
          console.log('All predictions:', predictions.map(p => ({ class: p.class, score: p.score })));
          
          // Filter for chairs and persons only
          const relevantDetections = predictions.filter(prediction => 
            prediction.class === 'person' || prediction.class === 'chair'
          );
          
          console.log('Relevant detections:', relevantDetections);
          setDetections(relevantDetections);
          
          // Voice announcements for detected objects (with error handling)
          if (relevantDetections.length > 0) {
            console.log('Processing voice announcements for detections');
            try {
              relevantDetections.forEach(detection => {
                announceDetection(detection.class, Math.round(detection.score * 100));
              });
            } catch (voiceError) {
              console.error('Voice announcement error:', voiceError);
            }
          }
        } else {
          console.log('Video not ready:', {
            readyState: video?.readyState,
            dimensions: `${video?.videoWidth || 0}x${video?.videoHeight || 0}`
          });
        }
      } catch (error) {
        console.error('Detection error:', error);
      }
    };

    // Initial detection after short delay
    const initialTimeout = setTimeout(() => {
      console.log('Running initial detection...');
      detectObjects();
    }, 3000); // Longer delay for mobile

    const interval = setInterval(() => {
      console.log('Interval tick - running detection');
      detectObjects();
    }, 3000); // Slower interval for mobile stability
    
    return () => {
      console.log('Cleaning up detection interval');
      clearTimeout(initialTimeout);
      clearInterval(interval);
    };
  }, [model, isLoading]); // Removed lastVoiceAnnouncement from dependencies to prevent loops

  const renderDetectionBoxes = () => {
    if (!videoRef.current || detections.length === 0) return null;
    
    const video = videoRef.current;
    const scaleX = video.offsetWidth / video.videoWidth;
    const scaleY = video.offsetHeight / video.videoHeight;

    return detections.map((detection, index) => {
      const [x, y, width, height] = detection.bbox;
      return (
        <div
          key={index}
          className="absolute border-3 border-pink-500 bg-pink-500 bg-opacity-20 rounded-lg"
          style={{
            left: x * scaleX,
            top: y * scaleY,
            width: width * scaleX,
            height: height * scaleY,
          }}
        >
          <div className="bg-pink-500 text-white px-2 py-1 text-xs rounded-t-lg font-bold">
            {detection.class} ({Math.round(detection.score * 100)}%)
          </div>
        </div>
      );
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-900 via-pink-800 to-red-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-white mx-auto mb-4"></div>
          <h2 className="text-white text-xl font-bold">
            {!isModelLoaded ? 'Loading AI model...' : 
             cameraStatus === 'requesting' ? 'Requesting camera access...' : 
             'Getting camera ready...'}
          </h2>
          <p className="text-gray-300 mt-2">
            {!isModelLoaded ? 'Setting up object detection' : 
             'Please allow camera access when prompted'}
          </p>
          {cameraError && (
            <div className="mt-4 p-4 bg-red-500/20 border border-red-500 rounded-lg">
              <p className="text-red-300 font-medium">Camera Error:</p>
              <p className="text-red-200 text-sm mt-1">{cameraError}</p>
              <p className="text-gray-300 text-xs mt-2">
                Make sure to allow camera access in your browser settings
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black relative overflow-hidden">
      {/* Video Container - TikTok style */}
      <div className="relative w-full h-screen">
        <video
          ref={videoRef}
          className="w-full h-full object-cover"
          muted
          playsInline
        />
        
        {/* Detection Overlay */}
        <div className="absolute inset-0">
          {renderDetectionBoxes()}
        </div>

        {/* Top UI Bar */}
        <div className="absolute top-0 left-0 right-0 bg-gradient-to-b from-black/60 to-transparent p-4 z-10">
          <div className="flex items-center justify-between">
            <h1 className="text-white text-xl font-bold">Object Detector</h1>
            <div className="flex items-center space-x-2">
              <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
              <span className="text-white text-sm font-medium">LIVE</span>
              <div className="ml-4 text-white text-xs flex items-center space-x-1">
                <span>🔊</span>
                <span>
                  {!speechSupported ? 'Voice: Not supported' : 
                   !voiceEnabled ? (isMobile ? 'Tap screen to enable voice' : 'Click to enable voice') : 
                   'Voice: ON'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Notification System (Fallback for voice) */}
        <div className="absolute top-20 left-4 right-4 z-20 space-y-2">
          {notifications.map(notification => (
            <div
              key={notification.id}
              className="bg-gradient-to-r from-blue-500 to-purple-600 text-white px-4 py-3 rounded-full shadow-lg animate-bounce flex items-center space-x-3"
            >
              <div className="w-3 h-3 bg-white rounded-full animate-pulse"></div>
              <span className="font-bold text-lg">
                {notification.message}
              </span>
            </div>
          ))}
        </div>

        {/* Debug Panel - Hide on small screens */}
        <div className="absolute top-20 right-4 bg-black/70 text-white p-3 rounded-lg text-xs max-w-xs z-30 hidden md:block">
          <div className="font-bold mb-2">🔧 Debug Info</div>
          <div>Backend: {typeof tf !== 'undefined' ? tf.getBackend() : 'loading...'}</div>
          <div>Camera: {cameraStatus}</div>
          <div>Model: {isModelLoaded ? 'loaded' : 'loading'}</div>
          <div>Video Ready: {videoRef.current?.readyState || 0}/4</div>
          <div>Detections: {detections.length}</div>
          <div>Detection Runs: {detectionCount}</div>
          <div>Voice: {speechSupported ? (voiceEnabled ? 'enabled' : 'needs interaction') : 'not supported'}</div>
          <div>Mobile: {isMobile ? 'yes' : 'no'}</div>
          <div className="mt-2">
            <div className="text-yellow-300 font-bold">Voice Cooldowns:</div>
            {Object.entries(lastVoiceAnnouncement).map(([objectType, timestamp]) => {
              const timeLeft = Math.max(0, 30 - Math.floor((Date.now() - timestamp) / 1000));
              return (
                <div key={objectType} className="text-xs">
                  {objectType}: {timeLeft > 0 ? `${timeLeft}s` : 'ready'}
                </div>
              );
            })}
          </div>
          <button 
            onClick={runManualDetection}
            className="mt-2 bg-pink-500 hover:bg-pink-600 px-2 py-1 rounded text-white text-xs mr-2"
          >
            🔍 Test Detection
          </button>
          <button 
            onClick={testVoice}
            className="mt-2 bg-blue-500 hover:bg-blue-600 px-2 py-1 rounded text-white text-xs"
          >
            🔊 Test Voice
          </button>
          {cameraError && <div className="text-red-300 mt-1">Error: {cameraError}</div>}
        </div>

        {/* Bottom Info Panel */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-6 z-10">
          <div className="text-center">
            <div className="text-white text-lg mb-2">
              Looking for: <span className="font-bold text-pink-400">People</span> & <span className="font-bold text-purple-400">Chairs</span>
            </div>
            
            {detections.length > 0 ? (
              <div className="flex flex-wrap justify-center gap-2 mt-3">
                {detections.map((detection, index) => (
                  <div
                    key={index}
                    className="bg-white/20 backdrop-blur-sm text-white px-3 py-1 rounded-full text-sm font-medium"
                  >
                    {detection.class} - {Math.round(detection.score * 100)}%
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-gray-300 text-sm mt-2">
                👀 Scanning for objects...
              </div>
            )}
            
            <div className="text-gray-400 text-xs mt-3">
              {speechSupported ? (
                voiceEnabled ? 
                  '🔊 Voice announcements with 30-second cooldown' :
                  `📱 ${isMobile ? 'Tap screen' : 'Click anywhere'} to enable voice announcements`
              ) : (
                '📱 Voice not supported - using visual notifications'
              )}
            </div>
          </div>
        </div>

        {/* Floating Action Indicator */}
        <div className="absolute right-4 top-1/2 transform -translate-y-1/2 z-10">
          <div className="bg-white/20 backdrop-blur-sm rounded-full p-4">
            <div className="text-center">
              <div className="text-2xl mb-2">🔍</div>
              <div className="text-white text-xs font-bold">AI Vision</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;