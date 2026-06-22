/**
 * @env-module audio
 * @description Web Audio API 完整实现 - 支持 Profile 配置的音频指纹
 * @version 1.0.0
 * @compatibility Chrome 80+, Firefox 75+, Edge 79+
 */

(function() {
    'use strict';

    const Monitor = window.__EnvMonitor__ || {
        log: function() {},
        logCall: function() {},
        executeMock: function() { return { mocked: false }; }
    };

    const profile = (window.__profile__ && window.__profile__.audio) || {};
    const sf = typeof safefunction === 'function' ? safefunction : function() {};

    // ==================== AudioParam ====================
    function AudioParam(defaultValue, minValue, maxValue) {
        this.value = defaultValue;
        this.defaultValue = defaultValue;
        this.minValue = minValue !== undefined ? minValue : -3.4028235e+38;
        this.maxValue = maxValue !== undefined ? maxValue : 3.4028235e+38;
        this.automationRate = 'a-rate';
    }
    AudioParam.prototype.setValueAtTime = function(value, startTime) { this.value = value; return this; };
    AudioParam.prototype.linearRampToValueAtTime = function(value, endTime) { this.value = value; return this; };
    AudioParam.prototype.exponentialRampToValueAtTime = function(value, endTime) { this.value = value; return this; };
    AudioParam.prototype.setTargetAtTime = function(target, startTime, timeConstant) { this.value = target; return this; };
    AudioParam.prototype.setValueCurveAtTime = function(values, startTime, duration) { return this; };
    AudioParam.prototype.cancelScheduledValues = function(startTime) { return this; };
    AudioParam.prototype.cancelAndHoldAtTime = function(cancelTime) { return this; };
    sf(AudioParam.prototype.setValueAtTime);
    sf(AudioParam.prototype.linearRampToValueAtTime);
    sf(AudioParam.prototype.exponentialRampToValueAtTime);
    sf(AudioParam.prototype.setTargetAtTime);
    sf(AudioParam.prototype.setValueCurveAtTime);
    sf(AudioParam.prototype.cancelScheduledValues);
    sf(AudioParam.prototype.cancelAndHoldAtTime);

    // ==================== AudioNode ====================
    function AudioNode() {
        this.context = null;
        this.numberOfInputs = 1;
        this.numberOfOutputs = 1;
        this.channelCount = 2;
        this.channelCountMode = 'max';
        this.channelInterpretation = 'speakers';
    }
    AudioNode.prototype.connect = function(destination, outputIndex, inputIndex) {
        Monitor.logCall('AudioNode.connect', [], null);
        return destination;
    };
    AudioNode.prototype.disconnect = function(destination, output, input) {
        Monitor.logCall('AudioNode.disconnect', [], null);
    };
    AudioNode.prototype.addEventListener = function() {};
    AudioNode.prototype.removeEventListener = function() {};
    AudioNode.prototype.dispatchEvent = function() { return true; };
    sf(AudioNode.prototype.connect);
    sf(AudioNode.prototype.disconnect);

    // ==================== AudioDestinationNode ====================
    function AudioDestinationNode(ctx) {
        AudioNode.call(this);
        this.context = ctx;
        this.maxChannelCount = profile.maxChannelCount || 2;
        this.numberOfInputs = 1;
        this.numberOfOutputs = 0;
    }
    AudioDestinationNode.prototype = Object.create(AudioNode.prototype);
    AudioDestinationNode.prototype.constructor = AudioDestinationNode;

    // ==================== AudioListener ====================
    function AudioListener() {
        this.positionX = new AudioParam(0);
        this.positionY = new AudioParam(0);
        this.positionZ = new AudioParam(0);
        this.forwardX = new AudioParam(0);
        this.forwardY = new AudioParam(0);
        this.forwardZ = new AudioParam(-1);
        this.upX = new AudioParam(0);
        this.upY = new AudioParam(1);
        this.upZ = new AudioParam(0);
    }
    AudioListener.prototype.setPosition = function(x, y, z) {};
    AudioListener.prototype.setOrientation = function(x, y, z, ux, uy, uz) {};
    sf(AudioListener.prototype.setPosition);
    sf(AudioListener.prototype.setOrientation);

    // ==================== OscillatorNode ====================
    function OscillatorNode(ctx, options) {
        AudioNode.call(this);
        this.context = ctx;
        this.type = (options && options.type) || 'sine';
        this.frequency = new AudioParam((options && options.frequency) || 440, -22050, 22050);
        this.detune = new AudioParam((options && options.detune) || 0, -153600, 153600);
        this.numberOfInputs = 0;
        this.numberOfOutputs = 1;
        this.onended = null;
    }
    OscillatorNode.prototype = Object.create(AudioNode.prototype);
    OscillatorNode.prototype.constructor = OscillatorNode;
    OscillatorNode.prototype.start = function(when) { Monitor.logCall('OscillatorNode.start', [when], null); };
    OscillatorNode.prototype.stop = function(when) { Monitor.logCall('OscillatorNode.stop', [when], null); };
    OscillatorNode.prototype.setPeriodicWave = function(periodicWave) {};
    sf(OscillatorNode.prototype.start);
    sf(OscillatorNode.prototype.stop);
    sf(OscillatorNode.prototype.setPeriodicWave);

    // ==================== GainNode ====================
    function GainNode(ctx, options) {
        AudioNode.call(this);
        this.context = ctx;
        this.gain = new AudioParam((options && options.gain) || 1, -3.4028235e+38, 3.4028235e+38);
    }
    GainNode.prototype = Object.create(AudioNode.prototype);
    GainNode.prototype.constructor = GainNode;

    // ==================== DynamicsCompressorNode ====================
    function DynamicsCompressorNode(ctx, options) {
        AudioNode.call(this);
        this.context = ctx;
        this.threshold = new AudioParam((options && options.threshold) || -24, -100, 0);
        this.knee = new AudioParam((options && options.knee) || 30, 0, 40);
        this.ratio = new AudioParam((options && options.ratio) || 12, 1, 20);
        this.reduction = 0;
        this.attack = new AudioParam((options && options.attack) || 0.003, 0, 1);
        this.release = new AudioParam((options && options.release) || 0.25, 0, 1);
    }
    DynamicsCompressorNode.prototype = Object.create(AudioNode.prototype);
    DynamicsCompressorNode.prototype.constructor = DynamicsCompressorNode;

    // ==================== BiquadFilterNode ====================
    function BiquadFilterNode(ctx, options) {
        AudioNode.call(this);
        this.context = ctx;
        this.type = (options && options.type) || 'lowpass';
        this.frequency = new AudioParam((options && options.frequency) || 350, 0, 22050);
        this.detune = new AudioParam((options && options.detune) || 0, -153600, 153600);
        this.Q = new AudioParam((options && options.Q) || 1, -3.4028235e+38, 3.4028235e+38);
        this.gain = new AudioParam((options && options.gain) || 0, -3.4028235e+38, 3.4028235e+38);
    }
    BiquadFilterNode.prototype = Object.create(AudioNode.prototype);
    BiquadFilterNode.prototype.constructor = BiquadFilterNode;
    BiquadFilterNode.prototype.getFrequencyResponse = function(frequencyHz, magResponse, phaseResponse) {
        if (magResponse) for (var i = 0; i < magResponse.length; i++) magResponse[i] = 1;
        if (phaseResponse) for (var i = 0; i < phaseResponse.length; i++) phaseResponse[i] = 0;
    };
    sf(BiquadFilterNode.prototype.getFrequencyResponse);

    // ==================== AnalyserNode ====================
    function AnalyserNode(ctx, options) {
        AudioNode.call(this);
        this.context = ctx;
        this.fftSize = (options && options.fftSize) || 2048;
        this.frequencyBinCount = this.fftSize / 2;
        this.minDecibels = (options && options.minDecibels) || -100;
        this.maxDecibels = (options && options.maxDecibels) || -30;
        this.smoothingTimeConstant = (options && options.smoothingTimeConstant) || 0.8;
    }
    AnalyserNode.prototype = Object.create(AudioNode.prototype);
    AnalyserNode.prototype.constructor = AnalyserNode;
    AnalyserNode.prototype.getFloatFrequencyData = function(array) { if (array) array.fill(-Infinity); };
    AnalyserNode.prototype.getByteFrequencyData = function(array) { if (array) array.fill(0); };
    AnalyserNode.prototype.getFloatTimeDomainData = function(array) { if (array) array.fill(0); };
    AnalyserNode.prototype.getByteTimeDomainData = function(array) { if (array) array.fill(128); };
    sf(AnalyserNode.prototype.getFloatFrequencyData);
    sf(AnalyserNode.prototype.getByteFrequencyData);
    sf(AnalyserNode.prototype.getFloatTimeDomainData);
    sf(AnalyserNode.prototype.getByteTimeDomainData);

    // ==================== DelayNode ====================
    function DelayNode(ctx, options) {
        AudioNode.call(this);
        this.context = ctx;
        this.delayTime = new AudioParam((options && options.delayTime) || 0, 0, (options && options.maxDelayTime) || 1);
    }
    DelayNode.prototype = Object.create(AudioNode.prototype);
    DelayNode.prototype.constructor = DelayNode;

    // ==================== WaveShaperNode ====================
    function WaveShaperNode(ctx, options) {
        AudioNode.call(this);
        this.context = ctx;
        this.curve = (options && options.curve) || null;
        this.oversample = (options && options.oversample) || 'none';
    }
    WaveShaperNode.prototype = Object.create(AudioNode.prototype);
    WaveShaperNode.prototype.constructor = WaveShaperNode;

    // ==================== ConvolverNode ====================
    function ConvolverNode(ctx, options) {
        AudioNode.call(this);
        this.context = ctx;
        this.buffer = (options && options.buffer) || null;
        this.normalize = options && options.disableNormalization ? false : true;
    }
    ConvolverNode.prototype = Object.create(AudioNode.prototype);
    ConvolverNode.prototype.constructor = ConvolverNode;

    // ==================== StereoPannerNode ====================
    function StereoPannerNode(ctx, options) {
        AudioNode.call(this);
        this.context = ctx;
        this.pan = new AudioParam((options && options.pan) || 0, -1, 1);
    }
    StereoPannerNode.prototype = Object.create(AudioNode.prototype);
    StereoPannerNode.prototype.constructor = StereoPannerNode;

    // ==================== PannerNode ====================
    function PannerNode(ctx, options) {
        AudioNode.call(this);
        this.context = ctx;
        this.panningModel = (options && options.panningModel) || 'equalpower';
        this.distanceModel = (options && options.distanceModel) || 'inverse';
        this.positionX = new AudioParam(0);
        this.positionY = new AudioParam(0);
        this.positionZ = new AudioParam(0);
        this.orientationX = new AudioParam(1);
        this.orientationY = new AudioParam(0);
        this.orientationZ = new AudioParam(0);
        this.refDistance = (options && options.refDistance) || 1;
        this.maxDistance = (options && options.maxDistance) || 10000;
        this.rolloffFactor = (options && options.rolloffFactor) || 1;
        this.coneInnerAngle = (options && options.coneInnerAngle) || 360;
        this.coneOuterAngle = (options && options.coneOuterAngle) || 360;
        this.coneOuterGain = (options && options.coneOuterGain) || 0;
    }
    PannerNode.prototype = Object.create(AudioNode.prototype);
    PannerNode.prototype.constructor = PannerNode;
    PannerNode.prototype.setPosition = function(x, y, z) {};
    PannerNode.prototype.setOrientation = function(x, y, z) {};
    sf(PannerNode.prototype.setPosition);
    sf(PannerNode.prototype.setOrientation);

    // ==================== ChannelSplitterNode ====================
    function ChannelSplitterNode(ctx, options) {
        AudioNode.call(this);
        this.context = ctx;
        this.numberOfInputs = 1;
        this.numberOfOutputs = (options && options.numberOfOutputs) || 6;
    }
    ChannelSplitterNode.prototype = Object.create(AudioNode.prototype);
    ChannelSplitterNode.prototype.constructor = ChannelSplitterNode;

    // ==================== ChannelMergerNode ====================
    function ChannelMergerNode(ctx, options) {
        AudioNode.call(this);
        this.context = ctx;
        this.numberOfInputs = (options && options.numberOfInputs) || 6;
        this.numberOfOutputs = 1;
    }
    ChannelMergerNode.prototype = Object.create(AudioNode.prototype);
    ChannelMergerNode.prototype.constructor = ChannelMergerNode;

    // ==================== ScriptProcessorNode (deprecated but used by fingerprinters) ====================
    function ScriptProcessorNode(ctx, bufferSize, numInputChannels, numOutputChannels) {
        AudioNode.call(this);
        this.context = ctx;
        this.bufferSize = bufferSize || 4096;
        this.numberOfInputs = 1;
        this.numberOfOutputs = 1;
        this.onaudioprocess = null;
    }
    ScriptProcessorNode.prototype = Object.create(AudioNode.prototype);
    ScriptProcessorNode.prototype.constructor = ScriptProcessorNode;

    // ==================== AudioWorkletNode (stub) ====================
    function AudioWorkletNode(ctx, name, options) {
        AudioNode.call(this);
        this.context = ctx;
        this.parameters = new Map();
        this.port = {
            postMessage: function() {},
            onmessage: null,
            onmessageerror: null,
            start: function() {},
            close: function() {},
            addEventListener: function() {},
            removeEventListener: function() {}
        };
        this.onprocessorerror = null;
    }
    AudioWorkletNode.prototype = Object.create(AudioNode.prototype);
    AudioWorkletNode.prototype.constructor = AudioWorkletNode;

    // ==================== AudioBuffer ====================
    function AudioBuffer(options) {
        this.sampleRate = (options && options.sampleRate) || profile.sampleRate || 44100;
        this.length = (options && options.length) || 0;
        this.duration = this.length / this.sampleRate;
        this.numberOfChannels = (options && options.numberOfChannels) || 1;
        this._channels = [];
        for (var i = 0; i < this.numberOfChannels; i++) {
            this._channels.push(new Float32Array(this.length));
        }
    }
    AudioBuffer.prototype.getChannelData = function(channel) {
        return this._channels[channel] || new Float32Array(0);
    };
    AudioBuffer.prototype.copyFromChannel = function(destination, channelNumber, bufferOffset) {
        var src = this._channels[channelNumber];
        if (src && destination) {
            var offset = bufferOffset || 0;
            for (var i = 0; i < destination.length && (i + offset) < src.length; i++) {
                destination[i] = src[i + offset];
            }
        }
    };
    AudioBuffer.prototype.copyToChannel = function(source, channelNumber, bufferOffset) {
        var dest = this._channels[channelNumber];
        if (dest && source) {
            var offset = bufferOffset || 0;
            for (var i = 0; i < source.length && (i + offset) < dest.length; i++) {
                dest[i + offset] = source[i];
            }
        }
    };
    sf(AudioBuffer.prototype.getChannelData);
    sf(AudioBuffer.prototype.copyFromChannel);
    sf(AudioBuffer.prototype.copyToChannel);

    // ==================== AudioBufferSourceNode ====================
    function AudioBufferSourceNode(ctx, options) {
        AudioNode.call(this);
        this.context = ctx;
        this.buffer = (options && options.buffer) || null;
        this.loop = (options && options.loop) || false;
        this.loopStart = (options && options.loopStart) || 0;
        this.loopEnd = (options && options.loopEnd) || 0;
        this.playbackRate = new AudioParam((options && options.playbackRate) || 1, -3.4028235e+38, 3.4028235e+38);
        this.detune = new AudioParam((options && options.detune) || 0, -153600, 153600);
        this.numberOfInputs = 0;
        this.numberOfOutputs = 1;
        this.onended = null;
    }
    AudioBufferSourceNode.prototype = Object.create(AudioNode.prototype);
    AudioBufferSourceNode.prototype.constructor = AudioBufferSourceNode;
    AudioBufferSourceNode.prototype.start = function(when, offset, duration) {};
    AudioBufferSourceNode.prototype.stop = function(when) {};
    sf(AudioBufferSourceNode.prototype.start);
    sf(AudioBufferSourceNode.prototype.stop);

    // ==================== PeriodicWave ====================
    function PeriodicWave(ctx, options) {
        this.real = (options && options.real) || null;
        this.imag = (options && options.imag) || null;
    }

    // ==================== BaseAudioContext methods ====================
    function applyBaseAudioContext(proto) {
        proto.createOscillator = function() { return new OscillatorNode(this); };
        proto.createGain = function() { return new GainNode(this); };
        proto.createDynamicsCompressor = function() { return new DynamicsCompressorNode(this); };
        proto.createAnalyser = function() { return new AnalyserNode(this); };
        proto.createBiquadFilter = function() { return new BiquadFilterNode(this); };
        proto.createDelay = function(maxDelayTime) { return new DelayNode(this, { maxDelayTime: maxDelayTime || 1 }); };
        proto.createWaveShaper = function() { return new WaveShaperNode(this); };
        proto.createConvolver = function() { return new ConvolverNode(this); };
        proto.createStereoPanner = function() { return new StereoPannerNode(this); };
        proto.createPanner = function() { return new PannerNode(this); };
        proto.createChannelSplitter = function(numberOfOutputs) { return new ChannelSplitterNode(this, { numberOfOutputs: numberOfOutputs }); };
        proto.createChannelMerger = function(numberOfInputs) { return new ChannelMergerNode(this, { numberOfInputs: numberOfInputs }); };
        proto.createBuffer = function(numberOfChannels, length, sampleRate) {
            return new AudioBuffer({ numberOfChannels: numberOfChannels, length: length, sampleRate: sampleRate });
        };
        proto.createBufferSource = function() { return new AudioBufferSourceNode(this); };
        proto.createScriptProcessor = function(bufferSize, numInputChannels, numOutputChannels) {
            return new ScriptProcessorNode(this, bufferSize, numInputChannels, numOutputChannels);
        };
        proto.createPeriodicWave = function(real, imag, constraints) {
            return new PeriodicWave(this, { real: real, imag: imag });
        };
        proto.createConstantSource = function() {
            var node = new AudioNode();
            node.context = this;
            node.offset = new AudioParam(1);
            node.start = function() {};
            node.stop = function() {};
            node.onended = null;
            sf(node.start);
            sf(node.stop);
            return node;
        };
        proto.createIIRFilter = function(feedforward, feedback) {
            var node = new AudioNode();
            node.context = this;
            node.getFrequencyResponse = function(frequencyHz, magResponse, phaseResponse) {
                if (magResponse) for (var i = 0; i < magResponse.length; i++) magResponse[i] = 1;
                if (phaseResponse) for (var i = 0; i < phaseResponse.length; i++) phaseResponse[i] = 0;
            };
            sf(node.getFrequencyResponse);
            return node;
        };
        proto.decodeAudioData = function(audioData, successCallback, errorCallback) {
            var buffer = new AudioBuffer({ numberOfChannels: 2, length: 44100, sampleRate: this.sampleRate });
            if (successCallback) successCallback(buffer);
            return Promise.resolve(buffer);
        };

        sf(proto.createOscillator);
        sf(proto.createGain);
        sf(proto.createDynamicsCompressor);
        sf(proto.createAnalyser);
        sf(proto.createBiquadFilter);
        sf(proto.createDelay);
        sf(proto.createWaveShaper);
        sf(proto.createConvolver);
        sf(proto.createStereoPanner);
        sf(proto.createPanner);
        sf(proto.createChannelSplitter);
        sf(proto.createChannelMerger);
        sf(proto.createBuffer);
        sf(proto.createBufferSource);
        sf(proto.createScriptProcessor);
        sf(proto.createPeriodicWave);
        sf(proto.createConstantSource);
        sf(proto.createIIRFilter);
        sf(proto.decodeAudioData);
    }

    // ==================== AudioContext ====================
    function AudioContext(options) {
        this.sampleRate = (options && options.sampleRate) || profile.sampleRate || 44100;
        this.state = profile.state || 'running';
        this.baseLatency = profile.baseLatency || 0.005333;
        this.outputLatency = profile.outputLatency || 0.016;
        this.currentTime = 0;
        this.destination = new AudioDestinationNode(this);
        this.listener = new AudioListener();
        this.audioWorklet = {
            addModule: function(moduleURL) { return Promise.resolve(); }
        };
        sf(this.audioWorklet.addModule);
        Monitor.logCall('AudioContext', [options], null);
    }
    applyBaseAudioContext(AudioContext.prototype);
    AudioContext.prototype.close = function() { this.state = 'closed'; return Promise.resolve(); };
    AudioContext.prototype.suspend = function() { this.state = 'suspended'; return Promise.resolve(); };
    AudioContext.prototype.resume = function() { this.state = 'running'; return Promise.resolve(); };
    AudioContext.prototype.getOutputTimestamp = function() { return { contextTime: this.currentTime, performanceTime: 0 }; };
    AudioContext.prototype.createMediaElementSource = function(mediaElement) {
        var node = new AudioNode();
        node.context = this;
        node.mediaElement = mediaElement;
        return node;
    };
    AudioContext.prototype.createMediaStreamSource = function(mediaStream) {
        var node = new AudioNode();
        node.context = this;
        return node;
    };
    AudioContext.prototype.createMediaStreamDestination = function() {
        var node = new AudioNode();
        node.context = this;
        node.stream = { getTracks: function() { return []; }, getAudioTracks: function() { return []; } };
        return node;
    };
    AudioContext.prototype.addEventListener = function() {};
    AudioContext.prototype.removeEventListener = function() {};
    AudioContext.prototype.dispatchEvent = function() { return true; };
    sf(AudioContext.prototype.close);
    sf(AudioContext.prototype.suspend);
    sf(AudioContext.prototype.resume);
    sf(AudioContext.prototype.getOutputTimestamp);
    sf(AudioContext.prototype.createMediaElementSource);
    sf(AudioContext.prototype.createMediaStreamSource);
    sf(AudioContext.prototype.createMediaStreamDestination);

    // ==================== OfflineAudioContext ====================
    function OfflineAudioContext(numberOfChannels, length, sampleRate) {
        if (typeof numberOfChannels === 'object') {
            var opts = numberOfChannels;
            numberOfChannels = opts.numberOfChannels || 1;
            length = opts.length;
            sampleRate = opts.sampleRate;
        }
        this.numberOfChannels = numberOfChannels || 1;
        this.length = length || 0;
        this.sampleRate = sampleRate || profile.sampleRate || 44100;
        this.state = 'suspended';
        this.currentTime = 0;
        this.destination = new AudioDestinationNode(this);
        this.listener = new AudioListener();
        this.oncomplete = null;
        Monitor.logCall('OfflineAudioContext', [numberOfChannels, length, sampleRate], null);
    }
    applyBaseAudioContext(OfflineAudioContext.prototype);

    OfflineAudioContext.prototype.startRendering = function() {
        var self = this;
        Monitor.logCall('OfflineAudioContext.startRendering', [], null);
        return new Promise(function(resolve) {
            var buffer = new AudioBuffer({
                numberOfChannels: self.numberOfChannels,
                length: self.length,
                sampleRate: self.sampleRate
            });

            var channelData = buffer.getChannelData(0);
            var seed = (profile.fingerprint && profile.fingerprint.seed) || 73920156;
            var targetSum = profile.fingerprint && profile.fingerprint.sum;

            // Seeded PRNG to generate deterministic audio data
            var s = seed;
            for (var i = 0; i < channelData.length; i++) {
                s = (s * 1664525 + 1013904223) & 0xFFFFFFFF;
                channelData[i] = ((s >>> 16) / 65536.0) * 2 - 1;
            }

            // Normalize to match target fingerprint sum if specified
            if (targetSum !== undefined && channelData.length > 0) {
                var currentSum = 0;
                for (var i = 0; i < channelData.length; i++) currentSum += channelData[i];
                var adjust = (targetSum - currentSum) / channelData.length;
                for (var i = 0; i < channelData.length; i++) channelData[i] += adjust;
            }

            self.state = 'closed';
            var event = { renderedBuffer: buffer };
            if (self.oncomplete) self.oncomplete(event);
            resolve(buffer);
        });
    };
    OfflineAudioContext.prototype.suspend = function(suspendTime) { return Promise.resolve(); };
    OfflineAudioContext.prototype.resume = function() { return Promise.resolve(); };
    OfflineAudioContext.prototype.addEventListener = function() {};
    OfflineAudioContext.prototype.removeEventListener = function() {};
    OfflineAudioContext.prototype.dispatchEvent = function() { return true; };
    sf(OfflineAudioContext.prototype.startRendering);
    sf(OfflineAudioContext.prototype.suspend);
    sf(OfflineAudioContext.prototype.resume);

    // ==================== Expose globally ====================
    window.AudioContext = AudioContext;
    window.webkitAudioContext = AudioContext;
    window.OfflineAudioContext = OfflineAudioContext;
    window.webkitOfflineAudioContext = OfflineAudioContext;
    window.AudioNode = AudioNode;
    window.AudioParam = AudioParam;
    window.AudioBuffer = AudioBuffer;
    window.AudioBufferSourceNode = AudioBufferSourceNode;
    window.OscillatorNode = OscillatorNode;
    window.GainNode = GainNode;
    window.AnalyserNode = AnalyserNode;
    window.DynamicsCompressorNode = DynamicsCompressorNode;
    window.BiquadFilterNode = BiquadFilterNode;
    window.DelayNode = DelayNode;
    window.WaveShaperNode = WaveShaperNode;
    window.ConvolverNode = ConvolverNode;
    window.StereoPannerNode = StereoPannerNode;
    window.PannerNode = PannerNode;
    window.ChannelSplitterNode = ChannelSplitterNode;
    window.ChannelMergerNode = ChannelMergerNode;
    window.ScriptProcessorNode = ScriptProcessorNode;
    window.AudioWorkletNode = AudioWorkletNode;
    window.AudioDestinationNode = AudioDestinationNode;
    window.AudioListener = AudioListener;
    window.PeriodicWave = PeriodicWave;

    Monitor.log('WebAPI', 'audio.init', { sampleRate: profile.sampleRate || 44100 });
})();
