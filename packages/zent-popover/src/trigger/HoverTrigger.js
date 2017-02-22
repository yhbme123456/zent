import { PropTypes } from 'react';
import capitalize from 'zent-utils/lodash/capitalize';
import uniq from 'zent-utils/lodash/uniq';

import Trigger, { PopoverTriggerPropTypes } from './Trigger';

// Hover识别的状态
const HoverState = {
  Init: 1,

  // 延迟等待中
  Pending: 2,

  Finish: 3
};

/**
 * 创建一个新state，每个state是一次性的，识别完成后需要创建一个新的state
 *
 * @param {string} name state的名称
 * @param {function} onFinish 识别成功时的回掉函数
 */
const makeState = (name, onFinish, initState = HoverState.Init) => {
  let state = initState;

  return {
    transit(nextState) {
      console.log(`${name}: ${state} -> ${nextState}`); // eslint-disable-line

      state = nextState;

      if (state === HoverState.Finish) {
        onFinish();
      }
    },

    is(st) {
      return st === state;
    },

    name
  };
};

function forEachHook(hooks, action) {
  if (!hooks) {
    return;
  }

  const hookNames = Object.keys(hooks);
  hookNames.forEach(hookName => {
    const eventName = `mouse${hookName}`;
    if (action === 'install') {
      window.addEventListener(eventName, hooks[hookName], true);
    } else if (action === 'uninstall') {
      window.removeEventListener(eventName, hooks[hookName], true);
    }
  });
}

function makeRecognizer(state, options) {
  const recognizer = {
    ...options,

    destroy() {
      if (!state.is(HoverState.Finish)) {
        forEachHook(recognizer.global, 'uninstall');

        console.log(`destroy ${state.name}`); // eslint-disable-line
      }
    }
  };

  forEachHook(recognizer.global, 'install');
  return recognizer;
}

/**
 * 进入和离开的识别是独立的recognizer，每个recognizer可以绑定任意`onmouse***`事件。
 * 组件内部只需要提供识别完成后的回掉函数，不需要知道recognizer的细节。
 *
 * local下的事件是直接绑定在trigger上的
 * global下的事件是绑定在window上的capture事件
 */

/**
 * 进入状态的识别
 */
function makeHoverEnterRecognizer({ enterDelay, onEnter }) {
  const state = makeState('enter', onEnter);
  let timerId;

  const recognizer = makeRecognizer(state, {
    local: {
      enter() {
        state.transit(HoverState.Pending);

        timerId = setTimeout(() => {
          state.transit(HoverState.Finish);
          forEachHook(recognizer.global, 'uninstall');
        }, enterDelay);
      },

      leave() {
        if (timerId) {
          clearTimeout(timerId);
          timerId = undefined;

          state.transit(HoverState.Init);
        }
      }
    }
  });

  return recognizer;
}

/**
 * 离开状态的识别
 */
function makeHoverLeaveRecognizer({ leaveDelay, onLeave, isOutSide }) {
  const state = makeState('leave', onLeave);
  let timerId;

  const recognizer = makeRecognizer(state, {
    global: {
      move(evt) {
        const { target } = evt;

        if (isOutSide(target)) {
          if (!state.is(HoverState.Init)) {
            return;
          }

          state.transit(HoverState.Pending);

          timerId = setTimeout(() => {
            state.transit(HoverState.Finish);
            forEachHook(recognizer.global, 'uninstall');
          }, leaveDelay);
        } else {
          if (!state.is(HoverState.Pending)) {
            return;
          }

          if (timerId) {
            clearTimeout(timerId);
            timerId = undefined;

            state.transit(HoverState.Init);
          }
        }
      }
    }
  });

  return recognizer;
}

function callHook(recognizer, namespace, hookName, ...args) {
  const ns = recognizer && recognizer[namespace];
  if (ns && ns[hookName]) ns[hookName](...args);
}

function destroyRecognizer(recognizer) {
  if (recognizer) {
    recognizer.destroy();
  }
}

export default class PopoverHoverTrigger extends Trigger {
  static propTypes = {
    ...PopoverTriggerPropTypes,

    showDelay: PropTypes.number,
    hideDelay: PropTypes.number,

    isOutside: PropTypes.func
  };

  static defaultProps = {
    showDelay: 150,
    hideDelay: 150
  }

  open = () => {
    this.props.open();
  };

  close = () => {
    this.props.close();
  };

  state = {
    enterRecognizer: this.makeEnterRecognizer(),
    leaveRecognizer: null
  };

  makeEnterRecognizer() {
    return makeHoverEnterRecognizer({
      enterDelay: this.props.showDelay,
      onEnter: this.open
    });
  }

  makeLeaveRecognizer() {
    return makeHoverLeaveRecognizer({
      leaveDelay: this.props.hideDelay,
      onLeave: this.close,
      isOutSide: this.isOutSide
    });
  }

  isOutSide = (node) => {
    const { getTriggerNode, getContentNode, isOutside } = this.props;

    if (isOutside && isOutside(node)) {
      return true;
    }

    const contentNode = getContentNode();
    const triggerNode = getTriggerNode();

    if (contentNode && contentNode.contains(node) || triggerNode && triggerNode.contains(node)) {
      return false;
    }

    return true;
  }

  getTriggerProps(child) {
    const { enterRecognizer, leaveRecognizer } = this.state;
    const enterHooks = (enterRecognizer && enterRecognizer.local) || {};
    const leaveHooks = (leaveRecognizer && leaveRecognizer.local) || {};
    const eventNames = uniq([].concat(Object.keys(enterHooks), Object.keys(leaveHooks)))
      .map(name => `onMouse${capitalize(name)}`);
    const eventNameToHookName = eventName => eventName.slice('onMouse'.length).toLowerCase();

    return eventNames.reduce((events, evtName) => {
      const hookName = eventNameToHookName(evtName);
      events[evtName] = evt => {
        callHook(enterRecognizer, 'local', hookName);
        callHook(leaveRecognizer, 'local', hookName);

        this.triggerEvent(child, evtName, evt);
      };

      return events;
    }, {});
  }

  cleanup() {
    // ensure global events are removed
    destroyRecognizer(this.state.enterRecognizer);
    destroyRecognizer(this.state.leaveRecognizer);
  }

  componentWillUnmount() {
    this.cleanup();
  }

  componentWillReceiveProps(nextProps) {
    const { contentVisible } = nextProps;

    // visibility changed, create new recognizers
    if (contentVisible !== this.props.contentVisible) {
      this.cleanup();

      this.setState({
        enterRecognizer: contentVisible ? null : this.makeEnterRecognizer(),
        leaveRecognizer: contentVisible ? this.makeLeaveRecognizer() : null
      });
    }
  }
}