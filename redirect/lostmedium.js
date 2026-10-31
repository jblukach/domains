function handler(event) {
  const response = {
    statusCode: 302,
    statusDescription: 'Found',
    headers: {
      'location': {value: 'https://github.com/lostmedium'},
    }
  };
  return response;
}