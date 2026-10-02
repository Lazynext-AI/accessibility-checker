// File: test/fetchMock.js
export const fetchMock = {
  enable: () => {
    global.fetch = jest.fn();
  },
  disable: () => {
    global.fetch = undefined;
  },
  mockResponseOnce: (response, options) => {
    global.fetch.mockImplementationOnce(() => Promise.resolve({
      ok: true,
      status: options.status,
      headers: options.headers,
      text: () => Promise.resolve(response),
    }));
  },
  mockRejectOnce: (error) => {
    global.fetch.mockImplementationOnce(() => Promise.reject(error));
  },
};