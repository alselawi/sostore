var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
export function debounce(func, wait) {
    let timeoutId = null;
    let lastPromise = null;
    return (...args) => {
        if (timeoutId !== null) {
            clearTimeout(timeoutId);
        }
        timeoutId = setTimeout(() => {
            timeoutId = null;
        }, wait);
        if (lastPromise === null) {
            lastPromise = new Promise((resolve, reject) => {
                timeoutId = setTimeout(() => __awaiter(this, void 0, void 0, function* () {
                    try {
                        const result = yield func(...args);
                        resolve(result);
                    }
                    catch (error) {
                        reject(error);
                    }
                    finally {
                        lastPromise = null;
                    }
                }), wait);
            });
        }
        return lastPromise;
    };
}
