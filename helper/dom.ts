import { Logger } from "library/lib/services/logger";
import { eventNamesLib } from "library/lib-fe/data/enum";

const logger: Logger = Logger.getInstance();

///////////////////////////
///   BUILDING BLOCKS   ///
///////////////////////////



//////////////////////////
///   CHILD ELEMENTS   ///
//////////////////////////

export async function clearChildren(parent: HTMLElement): Promise<void> {
  while (parent.firstChild) {
    parent.removeChild(parent.lastChild!);
  }
}
export async function clearChildrenOfType(parent: HTMLElement, tag: string): Promise<void> {
  for (let i = parent.children.length - 1; i >= 0; i--) {
    if ((parent.children[i].nodeName).toLowerCase() === tag) parent.children[i].remove();
  }
}
export async function clearChildrenOfClass(parent: HTMLElement, className: string): Promise<void> {
  for (let i = parent.children.length - 1; i >= 0; i--) {
    if (parent.children[i].classList.contains(className)) parent.children[i].remove();
  }
}

export async function findSelfIndexInParent(self: Element): Promise<number> {
  let element: Element | null = self;
  let index = 0;
  while (element.previousElementSibling) {
    element = element.previousElementSibling;
    index++;
  }
  return index;
}

export async function putElementBefore(newElement: Node, anchorElement: Node): Promise<void> {
  anchorElement.parentNode!.insertBefore(newElement, anchorElement);
}

export async function putElementAfter(newElement: Node, anchorElement: Node): Promise<void> {
  // console.log("---> putElementAfter(newElement, anchorElement)", newElement, anchorElement);
  if (anchorElement.nextSibling) {
    // console.log("anchorElement.nextSibling:", anchorElement.nextSibling);
    anchorElement.parentNode!.insertBefore(newElement, anchorElement.nextSibling);
  }
  else {
    // console.log("anchorElement.parentNode:", anchorElement.parentNode);
    anchorElement.parentNode!.appendChild(newElement);
  }
}

//////////////////////////
///   INPUT ELEMENTS   ///
//////////////////////////

export async function populateSelectorOptions(selector: HTMLSelectElement, options: Array<Record<string, string>>, valueKey: string, textKey: string): Promise<void> {
  if (!options) return;
  options.forEach(option => {
    let opt = document.createElement("option");
    opt.value = option[valueKey]
    opt.innerText = option[textKey];
    selector.appendChild(opt);
  });
}

export async function setDateInputAsToday(dateInput: HTMLInputElement): Promise<void> {
  const today = new Date();

  // Format the date as yyyy-mm-dd
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');

  dateInput.value = `${year}-${month}-${day}`;
}

//////////////////
///   EVENTS   ///
//////////////////

export async function emitCustomEvent(that: EventTarget, eventName: string, eventDetails: object): Promise<void> {
  that.dispatchEvent(new CustomEvent(eventName, {
    bubbles: true,
    composed: true,
    detail: eventDetails
  }));
};

export async function toggleSpinningCircle(that: EventTarget, state: boolean): Promise<void> {
  console.log("...");
  emitCustomEvent(that, eventNamesLib.TOGGLE_SPINNING_CIRCLE.description!, {
    bubbles: true,
    composed: true,
    state: state
  });
}

export async function emitNavigationEvent(that: EventTarget, targetUrl: string, stateData?: unknown): Promise<void> {
  logger?.debug("---> emitNavigationEvent()", that, String, stateData)
  emitCustomEvent(that, eventNamesLib.NAVIGATE.description!, {
    bubbles: true,
    composed: true,
    target: targetUrl,
    stateData: stateData
  });
}

export async function emitDialogEvent(that: EventTarget, webComponent: string, data: object, confirmCb?: Function, cancelCb?: Function): Promise<void> {
  emitCustomEvent(that, eventNamesLib.DIALOG_OPEN.description!, {
    bubbles: true,
    composed: true,
    element: webComponent,
    data: data,
    confirmCb: confirmCb,
    cancelCb: cancelCb
  });
}
export async function emitDialogConfirmEvent(that: EventTarget, data: unknown): Promise<void> {
  emitCustomEvent(that, eventNamesLib.DIALOG_CONFIRM.description!, {
    bubbles: true,
    composed: true,
    data: data
  });
}
export async function emitDialogCancelEvent(that: EventTarget): Promise<void> {
  emitCustomEvent(that, eventNamesLib.DIALOG_CANCEL.description!, {
    bubbles: true,
    composed: true
  });
}

export async function emitSubPageContainerEvent(that: EventTarget, route: string): Promise<void> {
  setTimeout(() => {
    emitCustomEvent(that, eventNamesLib.SUB_PAGE_CONTAINER.description!, {
      bubbles: true,
      composed: true,
      container: that,
      route: route
    });
  }, 0);
}

///////////////
///   CSS   ///
///////////////

export function getNumberFromPixelValue(element: HTMLElement, cssProperty: string): number {
  const style = getComputedStyle(element);
  const size = style.getPropertyValue(cssProperty);
  let len = size.length;
  let num = size.substring(0, len);
  return parseFloat(num);
}
