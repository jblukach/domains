function handler(event) {
  const response = {
    statusCode: 301,
    statusDescription: 'Moved Permanently',
    headers: {
      'location': {value: 'https://github.com/lostmedium'},
    }
  };
  return response;
}