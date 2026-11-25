function handler(event) {
  const response = {
    statusCode: 301,
    statusDescription: 'Moved Permanently',
    headers: {
      'location': {value: 'https://github.com/4n6ir'},
    }
  };
  return response;
}