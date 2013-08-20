define(function(require, exports){
  function Trigger(scope, registers){
    var self = this;
    self.$timer   = 0; // 正在触发事件调用
    self.$scope   = null;
    self.$regs    = {}; // 注册的触发器
    self.$queue   = []; // 触发器排序队列
    self.$signals = {}; // 信号变量临时存储
    self.$states  = {}; // 运行状态

    self.routine = function(){
      self._runCallback(true);
    }

    self.setScope(scope);
    if (registers && registers.length){
      for (var i=0; i<registers.length; i++){
        self.register(registers[i], true);
      }
      self._sortQueue();
    }
  }

  Trigger.prototype = {
    constructor: Trigger,
    /**
     * 设置作用域参数
     * @param  {Object} scope 作用域对象
     * @return {Object}       返回当前对象
     */
    setScope: function(scope){
      this.$scope = scope || window;
      return this;
    },
    /**
     * 注册触发事件
     * @param  {String} name    触发器名称
     * @param  {String} signals 触发信号名称, 英文逗号分隔多个信号
     * @param  {Mix}    event   触发函数, 字符串, 函数, 数组(作用域, 函数)
     * @param  {Mix}    data    触发函数的附加数据
     * @return {Object}         返回当前对象
     */
    register: function(option, skip_sort){
      var self   = this;
      var scope  = null;
      var event  = option.event;
      var signal = option.signals;
      if (typeof event === 'string'){
        event = self.$scope && self.$scope[event];
      }else if (event instanceof Array){
        scope = event[0];
        if (typeof event[1] === 'string'){
          event = scope && scope[event[1]];
        }
      }
      if (signal && event instanceof Function){
        var signals = option.signals = {};
        var depend  = option.depend = [];
        var list    = signal.split(',');
        option.wait = option.some = 0;
        for (var i=0; i<list.length; i++){
          signal = list[i];
          switch (signal.charAt(0)){
            case '@':
              depend.push(signal);
              break;
            case '*':
              option.some  = 1;
              signals[signal.slice(1)] = -1;
              break;
            default:
              if (!signals.hasOwnProperty(signal)){
                signals[signal] = 0;
                option.wait++;
              }
              break;
          }
        }
        if (option.wait === 0){
          option.wait = NaN;
        }
        var regs  = self.$regs;
        var queue = self.$queue;
        var name  = option.name;

        if (name === undefined){
          name = queue.length;
          while (regs.hasOwnProperty(name)){
            name++;
          }
          option.name = name;
        }
        option.event   = event;
        option.context = scope;
        option.changed = {};
        regs[name]     = option;

        if (!skip_sort){
          self._sortQueue();
        }
      }
      return self;
    },
    /**
     * 设置触发器状态为有效
     * @param  {Mix}     register    触发器项目对象或字符串触发器名称
     * @param  {Mix}     value       触发器状态信号变量
     * @param  {Boolean} no_callback <可选> 是否触发事件调用
     * @return {Objec}               返回当前对象
     */
    resolve: function(register, value, no_callback){
      var name = '@' + (typeof register === 'string' ? register : register.name);
      this.$states[name] = 1;
      this.$signals[name] = value;
      // console.log('++ resolve', name, value);
      return (no_callback ? this : this._runCallback());
    },
    /**
     * 设置触发器状态为无效
     * @param  {Mix}    register 触发器项目对象或字符串触发器名称
     * @return {Object}          返回当前对象
     */
    reject: function(register){
      var name = '@' + (typeof register === 'string' ? register : register.name);
      this.$states[name] = 0;
      delete this.$signals[name];
      // console.log('-- reject', name);
      return this;
    },
    /**
     * 触发信号
     * @param  {String}  name  信号名称字符串
     * @param  {Mix}     data  <可选> 信号变量
     * @param  {Boolean} check <可选> 检查变量变化
     * @return {Object}        返回当前对象
     */
    signal: function(name, data, check){
      var self = this;
      if (check && self.$signals[name] === data){
        return self;
      }
      // console.log('## signal', name, data);
      if (arguments.length > 1){
        self.$signals[name] = data;
      }

      // 检查处理
      var reg, signals, id;
      var run_callback = false;
      var registers = self.$regs;

      for (reg in registers){
        if (!registers.hasOwnProperty(reg)){
          continue;
        }
        reg     = registers[reg];
        signals = reg.signals;
        id      = signals[name];

        if (id === 0){
          reg.wait--;
          signals[name] = 1;
          run_callback  = (run_callback || reg.wait === 0);
        }else if (id === -1){
          reg.some      = -1;
          signals[name] = -2;
          run_callback  = (run_callback || reg.wait === 0 || isNaN(reg.wait));
        }
      }

      return (run_callback ? self._runCallback() : self);
    },
    // 更新信号变量参数值
    setData: function(name, data){
      // console.log('>> setdata', name, data);
      this.$signals[name] = data;
      return this;
    },
    getData: function(name, data){
      return this.$signals[name];
    },
    // 重置触发器信号状态
    clear: function(name){
      // console.log('!! clear', name);
      var self = this;
      var registers = self.$regs;
      var reg, signals, id;
      for (var i=0; i<registers.length; i++){
        reg = registers[i];
        if (name && reg !== name && reg.name !== name){
          continue;
        }
        if (reg.some === -1){
          reg.some = 1;
        }
        signals = reg.signals;
        reg.wait = 0;
        for (id in signals){
          if (!signals.hasOwnProperty(id)){
            continue;
          }
          switch (signals[id]){
            case 1:
              signals[id] = 0; // 清空信号标记
              reg.wait++;
              break;
            case -2:
              signals[id] = -1;
              break;
          }
        }
      }
      if (self.$timer){
        clearTimeout(self.$timer);
        self.$timer = 0;
      }
      return this;
    },
    /**
     * 清空所有信号状态数据
     * @return {Object} 返回当前对象
     */
    reset: function() {
      this.$signals = {};
      this.$states  = {};
      return this;
    },
    /**
     * 清空所有设置, 包括触发器设置信息
     * @return {Object} 返回当前对象
     */
    resetAll: function(){
      this.$regs  = {};
      this.$queue = [];
      return this.reset();
    },
    /**
     * 触发器调用顺序依赖顺序处理
     * @return {Object} 返回当前对象
     */
    _sortQueue: function(){
      var regs  = this.$regs;
      var queue = this.$queue;
      var next  = queue.length;
      var cache = [];
      var ready = {};
      var i, j, reg;

      // 先设置外部依赖(手动设置)
      for (reg in regs){
        if (!regs.hasOwnProperty(reg)){ continue; }
        cache.push(reg);
        reg = regs[reg];
        for (j=reg.depend.length; j>0;){
          i = reg.depend[--j];
          if (!regs.hasOwnProperty(i.slice(1))){
            ready[i] = 1;
          }
        }
      }
      queue.splice(0, next);
      next = cache.length;

      while (next){
        next = 0;
        for (i=0;i<cache.length;i++){
          reg = regs[cache[i]];
          for (j=reg.depend.length; j>0;){
            if (!ready.hasOwnProperty(reg.depend[--j])){
              reg = null;
              break;
            }
          }
          if (reg){
            cache.splice(i--,1);
            j = reg.name;
            queue.push(j);
            ready['@'+j] = 1;
            next = cache.length;
          }
        }
      }
      if (cache.length){
        // 警告, 有依赖的状态未设置
        if (console && console.warn){
          console.warn('警告: 存在环形依赖的触发器!', cache);
        }
        queue.push.apply(queue, cache);
      }
      return this;
    },
    /**
     * 异步触发回调事件
     * @param  {Boolean} run <可选> 执行状态指示
     * @return {Object}      返回当前对象
     */
    _runCallback: function(run){
      var self = this;
      if (run !== true){
        if (!self.$timer){
          // console.log('_runCallback', 'setTimeout');
          self.$timer = setTimeout(self.routine, 0);
        }
        return this;
      }

      // console.log('_runCallback', 'start');
      // 检查触发事件
      self.$timer = 0;
      var reg, i, j, param, signal, changed;
      var registers = self.$regs;
      var states    = self.$states;
      var queue     = self.$queue;
      for (i=0; i<queue.length; i++){
        reg = registers[queue[i]];
        if (reg.wait === 0 || (isNaN(reg.wait) && reg.some === -1)){
          param = {};
          // 判断依赖状态是否完整
          for (j=reg.depend.length; j>0;){
            signal = reg.depend[--j];
            if (states[signal] !== 1){
              reg = null;
              break;
            }
            param[signal] = self.$signals[signal];
          }
          if (!reg){
            continue;
          }

          // 准备信号变量参数与重置信号状态
          signal  = reg.signals;
          changed = reg.changed;
          for (j in signal){
            if (signal.hasOwnProperty(j)){
              param[j] = self.$signals[j];
              switch (signal[j]){
                case 1:
                  signal[j] = 0;
                  reg.wait++;
                  changed[j] = 1;
                  break;
                case -2:
                  signal[j] = -1;
                  changed[j] = 1;
                  break;
                default:
                  changed[j] = 0;
              }
            }
          }

          // 重置可选信号状态
          if (reg.some === -1){
            reg.some = 1;
          }

          // 把当前触发器状态设置为无效
          self.reject(reg);
          // 触发回调函数
          // console.log('--> callback', reg);
          j = reg.event.call(reg.context || self.$scope, param, reg);
          // 返回不是false, 表示已成功, 自动设置状态生效
          if (j !== false){
            self.resolve(reg, j, true);
          }
        }
      }
      // console.log('_runCallback', 'end');
    }
  };

  return Trigger;
})