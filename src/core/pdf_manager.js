/* Copyright 2012 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  createValidAbsoluteUrl, MissingDataException, shadow, unreachable, warn
} from '../shared/util';
import { ChunkedStreamManager } from './chunked_stream';
import { PDFDocument } from './document';
import { Stream } from './stream';

class BasePdfManager {
  constructor() {
    if (this.constructor === BasePdfManager) {
      unreachable('Cannot initialize BasePdfManager.');
    }
  }

  get docId() {
    return this._docId;
  }

  get password() {
    return this._password;
  }

  get docBaseUrl() {
    let docBaseUrl = null;
    if (this._docBaseUrl) {
      const absoluteUrl = createValidAbsoluteUrl(this._docBaseUrl);
      if (absoluteUrl) {
        docBaseUrl = absoluteUrl.href;
      } else {
        warn(`Invalid absolute docBaseUrl: "${this._docBaseUrl}".`);
      }
    }
    return shadow(this, 'docBaseUrl', docBaseUrl);
  }

  onLoadedStream() {
    unreachable('Abstract method `onLoadedStream` called');
  }

  ensureDoc(prop, args) {
    return this.ensure(this.pdfDocument, prop, args);
  }

  ensureXRef(prop, args) {
    return this.ensure(this.pdfDocument.xref, prop, args);
  }

  ensureCatalog(prop, args) {
    return this.ensure(this.pdfDocument.catalog, prop, args);
  }

  getPage(pageIndex) {
    return this.pdfDocument.getPage(pageIndex);
  }

  cleanup() {
    return this.pdfDocument.cleanup();
  }

  ensure(obj, prop, args) {
    unreachable('Abstract method `ensure` called');
  }

  requestRange(begin, end) {
    unreachable('Abstract method `requestRange` called');
  }

  requestLoadedStream() {
    unreachable('Abstract method `requestLoadedStream` called');
  }

  sendProgressiveData(chunk) {
    unreachable('Abstract method `sendProgressiveData` called');
  }

  updatePassword(password) {
    this._password = password;
  }

  terminate() {
    unreachable('Abstract method `terminate` called');
  }
}

class LocalPdfManager extends BasePdfManager {
  constructor(docId, data, password, evaluatorOptions, docBaseUrl) {
    super();

    this._docId = docId;
    this._password = password;
    this._docBaseUrl = docBaseUrl;
    this.evaluatorOptions = evaluatorOptions;

    const stream = new Stream(data);
    this.pdfDocument = new PDFDocument(this, stream);
    this._loadedStreamPromise = Promise.resolve(stream);
  }

  ensure(obj, prop, args) {
    return new Promise(function(resolve) {
      const value = obj[prop];
      if (typeof value === 'function') {
        resolve(value.apply(obj, args));
      } else {
        resolve(value);
      }
    });
  }

  requestRange(begin, end) {
    return Promise.resolve();
  }

  requestLoadedStream() {}

  onLoadedStream() {
    return this._loadedStreamPromise;
  }

  terminate() {}
}

class NetworkPdfManager extends BasePdfManager {
  constructor(docId, pdfNetworkStream, args, evaluatorOptions, docBaseUrl) {
    super();

    this._docId = docId;
    this._password = args.password;
    this._docBaseUrl = docBaseUrl;
    this.msgHandler = args.msgHandler;
    this.evaluatorOptions = evaluatorOptions;

    this.streamManager = new ChunkedStreamManager(pdfNetworkStream, {
      msgHandler: args.msgHandler,
      url: args.url,
      length: args.length,
      disableAutoFetch: args.disableAutoFetch,
      rangeChunkSize: args.rangeChunkSize,
    });
    this.pdfDocument = new PDFDocument(this, this.streamManager.getStream());
  }

  ensure(obj, prop, args) {
    return new Promise((resolve, reject) => {
      let ensureHelper = () => {
        try {
          const value = obj[prop];
          let result;
          if (typeof value === 'function') {
            result = value.apply(obj, args);
          } else {
            result = value;
          }
          resolve(result);
        } catch (ex) {
          if (!(ex instanceof MissingDataException)) {
            reject(ex);
            return;
          }
          this.streamManager.requestRange(ex.begin, ex.end)
            .then(ensureHelper, reject);
        }
      };

      ensureHelper();
    });
  }

  requestRange(begin, end) {
    return this.streamManager.requestRange(begin, end);
  }

  requestLoadedStream() {
    this.streamManager.requestAllChunks();
  }

  sendProgressiveData(chunk) {
    this.streamManager.onReceiveData({ chunk, });
  }

  onLoadedStream() {
    return this.streamManager.onLoadedStream();
  }

  terminate() {
    this.streamManager.abort();
  }
}

export {
  LocalPdfManager,
  NetworkPdfManager,
};
